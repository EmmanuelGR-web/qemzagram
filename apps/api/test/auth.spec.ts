import request from 'supertest';
import { eq } from 'drizzle-orm';
import { users } from '../src/database/schema';
import { createTestApp, ORIGIN, setCookies, signUp, STRONG_PASSWORD, type TestContext } from './support/test-app';

describe('Autenticación y seguridad de cuentas', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('expone el estado y aplica cabeceras de seguridad', async () => {
    const response = await http().get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toContain('max-age=');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('rechaza contraseñas débiles y tags inválidos con detalle', async () => {
    const weak = await http().post('/auth/register').set('Origin', ORIGIN).send({ acceptTerms: true, email: 'a@example.com', tag: 'debil', password: 'password123' }).expect(400);
    expect(weak.body.code).toBe('VALIDATION_ERROR');
    expect(weak.body.issues.length).toBeGreaterThan(0);

    await http().post('/auth/register').set('Origin', ORIGIN).send({ acceptTerms: true, email: 'a@example.com', tag: 'Ab', password: STRONG_PASSWORD }).expect(400);
    await http().post('/auth/register').set('Origin', ORIGIN).send({ acceptTerms: true, email: 'a@example.com', tag: 'admin', password: STRONG_PASSWORD }).expect(400);
    await http().post('/auth/register').set('Origin', ORIGIN).send({ acceptTerms: true, email: 'no-es-correo', tag: 'validotag', password: STRONG_PASSWORD }).expect(400);
    // la contraseña no puede contener el tag
    await http().post('/auth/register').set('Origin', ORIGIN).send({ acceptTerms: true, email: 'x@example.com', tag: 'segura', password: 'Qz!Segura2026-ok' }).expect(400);
  });

  it('registra, exige verificar el correo y permite iniciar sesión con tag o correo', async () => {
    const email = 'maria@example.com';
    await http().post('/auth/register').set('Origin', ORIGIN).send({ acceptTerms: true, email, tag: 'maria', password: STRONG_PASSWORD }).expect(202);

    const beforeVerify = await http().post('/auth/login').set('Origin', ORIGIN).send({ identifier: 'maria', password: STRONG_PASSWORD }).expect(403);
    expect(beforeVerify.body.code).toBe('EMAIL_NOT_VERIFIED');

    await http().post('/auth/verify-email').set('Origin', ORIGIN).send({ token: 'x'.repeat(30) }).expect(400);
    const token = ctx.mail.lastVerification(email);
    await http().post('/auth/verify-email').set('Origin', ORIGIN).send({ token }).expect(200);
    await http().post('/auth/verify-email').set('Origin', ORIGIN).send({ token }).expect(400); // un solo uso

    const byTag = await http().post('/auth/login').set('Origin', ORIGIN).send({ identifier: '@Maria', password: STRONG_PASSWORD }).expect(200);
    expect(setCookies(byTag).join(';')).toContain('HttpOnly');
    expect(setCookies(byTag).join(';')).toContain('SameSite=Strict');
    expect(JSON.stringify(byTag.body)).not.toContain('passwordHash');
    await http().post('/auth/login').set('Origin', ORIGIN).send({ identifier: email, password: STRONG_PASSWORD }).expect(200);
  });

  it('no permite repetir tags ni correos, y no revela si un correo existe', async () => {
    const duplicatedTag = await http().post('/auth/register').set('Origin', ORIGIN).send({ acceptTerms: true, email: 'otro@example.com', tag: 'MARIA', password: 'Zx#Distinta2026!' }).expect(409);
    expect(duplicatedTag.body.code).toBe('TAG_TAKEN');

    const before = ctx.mail.verifications.length;
    await http().post('/auth/register').set('Origin', ORIGIN).send({ acceptTerms: true, email: 'maria@example.com', tag: 'maria2', password: 'Zx#Distinta2026!' }).expect(202);
    expect(ctx.mail.accountExists).toContain('maria@example.com');
    expect(ctx.mail.verifications.length).toBe(before); // no se creó otra cuenta
    const rows = await ctx.db.select().from(users).where(eq(users.email, 'maria@example.com'));
    expect(rows).toHaveLength(1);
  });

  it('guarda la contraseña con Argon2id y nunca en texto plano', async () => {
    const [row] = await ctx.db.select().from(users).where(eq(users.tag, 'maria'));
    expect(row?.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(row?.passwordHash).not.toContain(STRONG_PASSWORD);
  });

  it('exige sesión y bloquea peticiones de otros orígenes (CSRF)', async () => {
    await http().get('/users/me').expect(401);
    await http().get('/chats').expect(401);
    await http().get('/contacts').expect(401);

    const user = await signUp(ctx, 'csrfuser');
    await user.agent.get('/users/me').expect(200);
    const cross = await request(ctx.app.getHttpServer())
      .post('/contacts')
      .set('Origin', 'https://sitio-malicioso.example')
      .set('Cookie', ((await user.agent.get('/users/me')).request as unknown as { header: { Cookie?: string } }).header.Cookie ?? 'qz_at=x')
      .send({ tag: 'maria' });
    expect(cross.status).toBe(403);
    const noOriginWithCookie = await request(ctx.app.getHttpServer()).post('/contacts').set('Cookie', 'qz_at=abc').send({ tag: 'maria' });
    expect(noOriginWithCookie.status).toBe(403);
  });

  it('rechaza tokens manipulados', async () => {
    const forged = await http().get('/users/me').set('Cookie', 'qz_at=eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.');
    expect(forged.status).toBe(401);
  });

  it('bloquea la cuenta tras 5 intentos fallidos', async () => {
    await signUp(ctx, 'bloqueada', 'Lm#Contra2026-xyz');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await http().post('/auth/login').set('Origin', ORIGIN).send({ identifier: 'bloqueada', password: 'incorrecta' }).expect(401);
    }
    const locked = await http().post('/auth/login').set('Origin', ORIGIN).send({ identifier: 'bloqueada', password: 'Lm#Contra2026-xyz' }).expect(429);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('responde igual ante usuarios inexistentes y contraseñas erróneas', async () => {
    const ghost = await http().post('/auth/login').set('Origin', ORIGIN).send({ identifier: 'nadie', password: 'cualquiera' }).expect(401);
    const wrong = await http().post('/auth/login').set('Origin', ORIGIN).send({ identifier: 'maria', password: 'cualquiera' }).expect(401);
    expect(ghost.body).toEqual(wrong.body);
  });

  it('rota el refresh token y detecta su reutilización (token robado)', async () => {
    const user = await signUp(ctx, 'rotacion', 'Rt#Rotar2026-seguro');
    const cookies = await http().post('/auth/login').set('Origin', ORIGIN).send({ identifier: 'rotacion', password: 'Rt#Rotar2026-seguro' }).expect(200);
    const refreshCookie = setCookies(cookies).find((value) => value.startsWith('qz_rt='))!.split(';')[0]!;

    const first = await http().post('/auth/refresh').set('Origin', ORIGIN).set('Cookie', refreshCookie).expect(200);
    expect(setCookies(first).join(';')).toContain('qz_rt=');

    // reutilizar el token viejo => se invalidan todas las sesiones
    await http().post('/auth/refresh').set('Origin', ORIGIN).set('Cookie', refreshCookie).expect(401);
    const newRefresh = setCookies(first).find((value) => value.startsWith('qz_rt='))!.split(';')[0]!;
    await http().post('/auth/refresh').set('Origin', ORIGIN).set('Cookie', newRefresh).expect(401);
    await user.agent.get('/users/me').expect(200); // el access token corto sigue hasta vencer
  });

  it('recupera la contraseña por correo y cierra las sesiones abiertas', async () => {
    const user = await signUp(ctx, 'olvidadiza', 'Ol#Olvido2026-viejo');
    await http().post('/auth/forgot-password').set('Origin', ORIGIN).send({ email: 'inexistente@example.com' }).expect(202);
    expect(ctx.mail.resets.find((item) => item.to === 'inexistente@example.com')).toBeUndefined();

    await http().post('/auth/forgot-password').set('Origin', ORIGIN).send({ email: user.email }).expect(202);
    const token = ctx.mail.lastReset(user.email);

    await http().post('/auth/reset-password').set('Origin', ORIGIN).send({ token, password: 'debil' }).expect(400);
    await http().post('/auth/reset-password').set('Origin', ORIGIN).send({ token, password: 'Nu#Nueva2026-clave' }).expect(200);
    await http().post('/auth/reset-password').set('Origin', ORIGIN).send({ token, password: 'Nu#Otra2026-clave' }).expect(400); // un solo uso
    expect(ctx.mail.passwordChanged).toContain(user.email);

    await http().post('/auth/login').set('Origin', ORIGIN).send({ identifier: 'olvidadiza', password: 'Ol#Olvido2026-viejo' }).expect(401);
    await http().post('/auth/login').set('Origin', ORIGIN).send({ identifier: 'olvidadiza', password: 'Nu#Nueva2026-clave' }).expect(200);
  });

  it('permite pausar la cuenta (se reactiva al volver) y darla de baja definitivamente', async () => {
    const user = await signUp(ctx, 'pausable', 'Pa#Pausa2026-segura');
    await user.agent.post('/users/me/pause').send({ password: 'incorrecta' }).expect(403);
    await user.agent.post('/users/me/pause').send({ password: 'Pa#Pausa2026-segura' }).expect(204);
    await http().get('/users/by-tag/pausable').set('Cookie', 'qz_at=x').expect(401);

    const back = await signUp(ctx, 'visitante', 'Vi#Visita2026-segura');
    await back.agent.get('/users/by-tag/pausable').expect(404); // pausada = invisible

    await http().post('/auth/login').set('Origin', ORIGIN).send({ identifier: 'pausable', password: 'Pa#Pausa2026-segura' }).expect(200);
    await back.agent.get('/users/by-tag/pausable').expect(200);

    const again = request.agent(ctx.app.getHttpServer()).set('Origin', ORIGIN);
    await again.post('/auth/login').send({ identifier: 'pausable', password: 'Pa#Pausa2026-segura' }).expect(200);
    await again.post('/users/me/delete').send({ password: 'Pa#Pausa2026-segura' }).expect(204);
    await http().post('/auth/login').set('Origin', ORIGIN).send({ identifier: 'pausable', password: 'Pa#Pausa2026-segura' }).expect(401);
    const [row] = await ctx.db.select().from(users).where(eq(users.id, user.id));
    expect(row?.email).toContain('invalid.qemzagram'); // datos personales anonimizados
    expect(row?.status).toBe('deleted');
  });
});
