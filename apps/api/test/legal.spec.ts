import { AUDIT_LOG_RETENTION_DAYS, LEGAL_VERSION } from '@qemzagram/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { RetentionService } from '../src/common/retention.service';
import { auditLog, sessions, users } from '../src/database/schema';
import { createTestApp, ORIGIN, setCookies, signUp, STRONG_PASSWORD, type TestContext } from './support/test-app';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Documentos legales: consentimiento y retención de datos', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const register = (body: Record<string, unknown>) => http().post('/auth/register').set('Origin', ORIGIN).send(body);

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('aceptación de Términos y Privacidad al registrarse', () => {
    it('sin aceptar (falta, false, o un texto en vez de true) no se crea la cuenta ni se manda correo', async () => {
      const base = { email: 'sin.aceptar@example.com', tag: 'sin.aceptar', password: STRONG_PASSWORD };
      for (const acceptTerms of [undefined, false, 'true', 1, null]) {
        const response = await register({ ...base, acceptTerms }).expect(400);
        expect(JSON.stringify(response.body)).toContain('18 años');
      }
      expect(await ctx.db.select().from(users).where(eq(users.tag, 'sin.aceptar'))).toEqual([]);
      expect(ctx.mail.verifications.some((sent) => sent.to === base.email)).toBe(false);
    });

    it('guarda la versión vigente y la fecha; la versión la pone el servidor, no el cliente', async () => {
      const before = Date.now();
      await register({
        email: 'acepta@example.com',
        tag: 'acepta',
        password: STRONG_PASSWORD,
        acceptTerms: true,
        // Campos que el cliente NO puede elegir: se descartan.
        termsVersion: '1999-01-01',
        termsAcceptedAt: '1999-01-01T00:00:00Z',
      }).expect(202);
      const [row] = await ctx.db.select().from(users).where(eq(users.tag, 'acepta'));
      expect(row?.termsVersion).toBe(LEGAL_VERSION);
      expect(row?.termsAcceptedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(row?.termsAcceptedAt?.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('la respuesta para un correo ya registrado no cambia (anti-enumeración)', async () => {
      const nuevo = await register({ email: 'enum.legal@example.com', tag: 'enum.legal', password: STRONG_PASSWORD, acceptTerms: true }).expect(202);
      const repetido = await register({ email: 'enum.legal@example.com', tag: 'enum.legal2', password: STRONG_PASSWORD, acceptTerms: true }).expect(202);
      expect(repetido.body).toEqual(nuevo.body);
    });
  });

  describe('retención: auditoría y sesiones', () => {
    it(`borra la auditoría de más de ${AUDIT_LOG_RETENTION_DAYS} días y conserva la reciente`, async () => {
      const now = new Date();
      const old = new Date(now.getTime() - (AUDIT_LOG_RETENTION_DAYS + 1) * DAY_MS);
      const recent = new Date(now.getTime() - (AUDIT_LOG_RETENTION_DAYS - 1) * DAY_MS);
      await ctx.db.insert(auditLog).values([
        { action: 'test.viejo', ip: '203.0.113.1', createdAt: old },
        { action: 'test.reciente', ip: '203.0.113.2', createdAt: recent },
      ]);

      const result = await ctx.app.get(RetentionService).run(now);

      expect(result.auditEntries).toBeGreaterThanOrEqual(1);
      expect(await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'test.viejo'))).toEqual([]);
      expect(await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'test.reciente'))).toHaveLength(1);
    });

    it('borra solo sesiones vencidas: la activa sigue funcionando', async () => {
      const user = await signUp(ctx, 'retencion', 'Rt#Retener2026-ok');
      const [expired] = await ctx.db
        .insert(sessions)
        .values({ userId: user.id, refreshHash: 'hash-vencido-de-prueba', ip: '203.0.113.9', userAgent: 'test', expiresAt: new Date(Date.now() - DAY_MS) })
        .returning();

      await ctx.app.get(RetentionService).run();

      expect(await ctx.db.select().from(sessions).where(eq(sessions.id, expired!.id))).toEqual([]);
      const remaining = await ctx.db.select().from(sessions).where(eq(sessions.userId, user.id));
      expect(remaining.length).toBeGreaterThanOrEqual(1);
      // La sesión vigente no se tocó: se puede seguir renovando.
      await user.agent.post('/auth/refresh').expect(200);
    });

    it('después de la limpieza se sigue detectando la reutilización de un refresh token robado', async () => {
      await signUp(ctx, 'robado', 'Zt#Ladron2026-ok');
      const login = await http().post('/auth/login').set('Origin', ORIGIN).send({ identifier: 'robado', password: 'Zt#Ladron2026-ok' }).expect(200);
      const stolen = setCookies(login).find((value) => value.startsWith('qz_rt='))!.split(';')[0]!;
      const rotated = await http().post('/auth/refresh').set('Origin', ORIGIN).set('Cookie', stolen).expect(200);
      const current = setCookies(rotated).find((value) => value.startsWith('qz_rt='))!.split(';')[0]!;

      // La sesión vieja quedó revocada pero NO vencida: la limpieza tiene que conservarla.
      await ctx.app.get(RetentionService).run();

      await http().post('/auth/refresh').set('Origin', ORIGIN).set('Cookie', stolen).expect(401);
      // Reapareció el token robado => se cerraron TODAS las sesiones, incluida la vigente.
      await http().post('/auth/refresh').set('Origin', ORIGIN).set('Cookie', current).expect(401);
    });
  });
});
