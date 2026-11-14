import type {
  ConversationDto,
  MessageDto,
  MyReportDto,
  ResolveReportResultDto,
  SelfUser,
  SupportAppealDto,
  SupportReportDetailDto,
  SupportReportDto,
  SupportStatsDto,
  SupportUserDto,
} from '@qemzagram/shared';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import { AuditService } from '../src/common/audit.service';
import { UsersRepository } from '../src/database/repositories/users.repository';
import { appeals, auditLog, reportEvidence, reports } from '../src/database/schema';
import { SupportCleanupService } from '../src/support/support-cleanup.service';
import { runSupportCommand } from '../src/support/support-role.cli';
import { binary } from './support/files';
import { createTestApp, enableMfa, ORIGIN, signUp, type TestContext, type TestUser } from './support/test-app';

describe('Panel de soporte: denuncias, bajas, apelaciones y estadísticas', () => {
  let ctx: TestContext;
  let soporte: TestUser;
  let ana: TestUser;
  let beto: TestUser;
  let carla: TestUser;
  let dani: TestUser;
  let malo: TestUser;
  let chatAnaMalo: string;

  const befriend = async (a: TestUser, b: TestUser) => {
    await a.agent.post('/contacts').send({ tag: b.tag }).expect(201);
    await b.agent.post('/contacts').send({ tag: a.tag }).expect(201);
  };
  const report = async (from: TestUser, target: TestUser, extra: Record<string, unknown> = {}) =>
    ((await from.agent.post('/reports').send({ userId: target.id, reason: 'harassment', ...extra }).expect(201)).body as MyReportDto).id;
  const resolve = (id: string, decision: 'confirm' | 'dismiss', by = soporte) => by.agent.post(`/support/reports/${id}/resolve`).send({ decision });
  const login = (user: TestUser) => request(ctx.app.getHttpServer()).post('/auth/login').set('Origin', ORIGIN).send({ identifier: user.tag, password: user.password });
  const appeal = (user: TestUser, extra: Record<string, unknown> = {}) =>
    request(ctx.app.getHttpServer())
      .post('/auth/appeal')
      .set('Origin', ORIGIN)
      .send({ identifier: user.tag, password: user.password, message: 'Creo que fue un error: nunca acosé a nadie, revisen por favor.', ...extra });

  beforeAll(async () => {
    ctx = await createTestApp();
    soporte = await signUp(ctx, 'soporte.equipo', 'So#Soporte2026-ok');
    ana = await signUp(ctx, 'ana.sop', 'An#Soporte2026-ok');
    beto = await signUp(ctx, 'beto.sop', 'Be#Soporte2026-ok');
    carla = await signUp(ctx, 'carla.sop', 'Ca#Soporte2026-ok');
    dani = await signUp(ctx, 'dani.sop', 'Da#Soporte2026-ok');
    malo = await signUp(ctx, 'malo.sop', 'Ma#Soporte2026-ok');
    // El rol se da SOLO por consola (no hay ruta HTTP para eso).
    expect(await runSupportCommand(ctx.app.get(UsersRepository), ctx.app.get(AuditService), 'grant', '@soporte.equipo')).toContain('soporte');
    // Sin segundo factor, una cuenta de soporte no puede usar el panel (Fase 7A).
    expect((await soporte.agent.get('/support/stats').expect(403)).body.code).toBe('MFA_REQUIRED');
    await enableMfa(ctx, soporte);
    await befriend(ana, malo);
    chatAnaMalo = ((await ana.agent.post('/chats/direct').send({ tag: malo.tag }).expect(200)).body as ConversationDto).id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('el rol se maneja solo por consola y /users/me lo informa', async () => {
    expect(((await soporte.agent.get('/users/me').expect(200)).body as SelfUser).role).toBe('support');
    expect(((await ana.agent.get('/users/me').expect(200)).body as SelfUser).role).toBe('user');
    // Nadie puede darse el rol por la web.
    await ana.agent.patch('/users/me').send({ role: 'support' }).expect(400);
    const users = ctx.app.get(UsersRepository);
    const audit = ctx.app.get(AuditService);
    expect(await runSupportCommand(users, audit, 'list')).toContain('@soporte.equipo');
    await expect(runSupportCommand(users, audit, 'grant', '@no.existe')).rejects.toThrow('No existe');
    await runSupportCommand(users, audit, 'grant', '@dani.sop');
    await runSupportCommand(users, audit, 'revoke', 'dani.sop');
    expect(((await dani.agent.get('/users/me').expect(200)).body as SelfUser).role).toBe('user');
  });

  it('sin rol de soporte, el panel "no existe" (404) y sin sesión pide login (401)', async () => {
    const server = ctx.app.getHttpServer();
    const id = '00000000-0000-4000-8000-000000000000';
    const routes: [string, string][] = [
      ['get', '/support/stats'],
      ['get', '/support/reports'],
      ['get', `/support/reports/${id}`],
      ['post', `/support/reports/${id}/resolve`],
      ['get', '/support/appeals'],
      ['post', `/support/appeals/${id}/resolve`],
      ['get', '/support/users?tag=ana.sop'],
      ['post', `/support/users/${id}/password-reset`],
    ];
    for (const [method, path] of routes) {
      const anonymous = method === 'get' ? request(server).get(path) : request(server).post(path);
      await anonymous.set('Origin', ORIGIN).expect(401);
      await (method === 'get' ? ana.agent.get(path) : ana.agent.post(path).send({ decision: 'confirm' })).expect(404);
    }
  });

  it('soporte ve la denuncia con SOLO la evidencia elegida; el archivo exige rol de soporte', async () => {
    const insult = ((await malo.agent.post(`/chats/${chatAnaMalo}/messages`).send({ body: 'Mensaje de acoso' }).expect(201)).body as MessageDto).id;
    await malo.agent.post(`/chats/${chatAnaMalo}/messages`).send({ body: 'Otro mensaje NO elegido' }).expect(201);
    const photo = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#f00' } }).png().toBuffer();
    const image = (
      await malo.agent.post(`/chats/${chatAnaMalo}/attachments`).field('kind', 'image').attach('file', photo, { filename: 'x.png', contentType: 'image/png' }).expect(201)
    ).body as MessageDto;
    const id = await report(ana, malo, { description: 'Me molesta todos los días', evidence: [{ type: 'message', id: insult }, { type: 'message', id: image.id }] });

    const pending = (await soporte.agent.get('/support/reports').expect(200)).body as SupportReportDto[];
    const listed = pending.find((item) => item.id === id);
    expect(listed).toMatchObject({ status: 'pending', description: 'Me molesta todos los días', evidenceCount: 2, reporter: { tag: ana.tag }, target: { tag: malo.tag, confirmedReports: 0 } });
    expect(JSON.stringify(listed)).not.toContain('@example.com'); // sin correos

    const detail = (await soporte.agent.get(`/support/reports/${id}`).expect(200)).body as SupportReportDetailDto;
    expect(detail.evidence.map((item) => item.body)).toContain('Mensaje de acoso');
    expect(JSON.stringify(detail)).not.toContain('NO elegido'); // nunca la conversación completa
    const media = detail.evidence.find((item) => item.media)?.media;
    expect(media?.url).toMatch(/^\/media\/r\//);
    const file = await soporte.agent.get(media?.url ?? '').buffer(true).parse(binary).expect(200);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    // Ni quien denunció ni la persona denunciada pueden abrir la evidencia, aunque tengan la URL firmada.
    await ana.agent.get(media?.url ?? '').expect(404);
    await malo.agent.get(media?.url ?? '').expect(404);
    // Soporte tampoco puede abrir el chat original.
    await soporte.agent.get(`/chats/${chatAnaMalo}`).expect(404);
    await soporte.agent.get(`/chats/${chatAnaMalo}/messages`).expect(404);
    expect((await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'support.report_viewed'))).length).toBeGreaterThan(0);

    // Descartar borra la evidencia; no se puede resolver dos veces.
    await resolve(id, 'dismiss').expect(200);
    expect(await ctx.db.select().from(reportEvidence).where(eq(reportEvidence.reportId, id))).toEqual([]);
    expect((await resolve(id, 'confirm').expect(409)).body.code).toBe('REPORT_ALREADY_RESOLVED');
    await soporte.agent.post(`/support/reports/${id}/resolve`).send({ decision: 'ban-forever' }).expect(400);
    expect(((await ana.agent.get('/reports/mine').expect(200)).body as MyReportDto[]).find((item) => item.id === id)?.reviewed).toBe(true);
  });

  it('nadie de soporte resuelve denuncias en las que es parte', async () => {
    const against = await report(ana, soporte);
    expect((await resolve(against, 'dismiss').expect(403)).body.code).toBe('SELF_REVIEW');
    const own = await report(soporte, ana);
    await resolve(own, 'dismiss').expect(403);
    await ctx.db.delete(reports).where(eq(reports.targetId, soporte.id));
    await ctx.db.delete(reports).where(eq(reports.reporterId, soporte.id));
  });

  it('3 denuncias confirmadas de personas DISTINTAS dan de baja la cuenta', async () => {
    await ctx.db.delete(reports);
    // La misma persona dos veces cuenta una sola.
    await resolve(await report(ana, malo), 'confirm').expect(200);
    await resolve(await report(ana, malo), 'confirm').expect(200);
    const second = (await resolve(await report(beto, malo), 'confirm').expect(200)).body as ResolveReportResultDto;
    expect(second).toMatchObject({ targetBanned: false, report: { target: { confirmedReports: 2 } } });
    await login(malo).expect(200);

    const third = (await resolve(await report(carla, malo), 'confirm').expect(200)).body as ResolveReportResultDto;
    expect(third.targetBanned).toBe(true);
    expect(third.report.target.status).toBe('banned');
    // Sesión cortada en el acto, login rechazado y aviso por correo con cómo apelar.
    await malo.agent.get('/users/me').expect(401);
    expect((await login(malo).expect(403)).body.code).toBe('ACCOUNT_BANNED');
    expect(ctx.mail.banned).toContain(malo.email);
    // El correo no se puede volver a registrar (la cuenta sigue ocupándolo).
    await request(ctx.app.getHttpServer()).post('/auth/register').set('Origin', ORIGIN).send({ email: malo.email, tag: 'malo.nuevo', password: 'Ma#Soporte2026-ok' }).expect(202);
    expect(await ctx.app.get(UsersRepository).findByTag('malo.nuevo')).toBeUndefined();
  });

  it('apelación: exige credenciales, una a la vez, y aceptarla reactiva la cuenta', async () => {
    await appeal(malo, { password: 'Otra#Clave2026-mal' }).expect(401);
    await appeal(ana).expect(409); // no está dada de baja
    await appeal(malo, { message: 'corto' }).expect(400);
    await appeal(malo, { userId: ana.id }).expect(400);
    await appeal(malo).expect(202);
    expect((await appeal(malo).expect(409)).body.code).toBe('APPEAL_ALREADY_OPEN');

    const [stored] = await ctx.db.select().from(appeals);
    expect(stored?.messageEncrypted).not.toContain('error'); // guardada cifrada
    const list = (await soporte.agent.get('/support/appeals').expect(200)).body as SupportAppealDto[];
    const pending = list.find((item) => item.user.id === malo.id);
    expect(pending).toMatchObject({ status: 'pending', confirmedReports: 3 });
    expect(pending?.message).toContain('nunca acosé');
    await ana.agent.get('/support/appeals').expect(404);

    const accepted = (await soporte.agent.post(`/support/appeals/${pending?.id}/resolve`).send({ decision: 'accept', note: 'Revisado' }).expect(200)).body as SupportAppealDto;
    expect(accepted.status).toBe('accepted');
    expect(ctx.mail.appealResults).toContainEqual({ to: malo.email, accepted: true });
    await login(malo).expect(200);
    // Las denuncias confirmadas se anulan: una nueva no vuelve a darla de baja enseguida.
    expect(((await soporte.agent.get(`/support/users?tag=${malo.tag}`).expect(200)).body as SupportUserDto).reports.confirmed).toBe(0);
    await soporte.agent.post(`/support/appeals/${pending?.id}/resolve`).send({ decision: 'reject' }).expect(409);
  });

  it('apelación rechazada: la baja se mantiene y hay que esperar para volver a apelar', async () => {
    await ctx.db.delete(reports);
    for (const from of [ana, beto, carla]) await resolve(await report(from, malo), 'confirm').expect(200);
    await appeal(malo).expect(202);
    const pending = ((await soporte.agent.get('/support/appeals').expect(200)).body as SupportAppealDto[]).find((item) => item.user.id === malo.id);
    await soporte.agent.post(`/support/appeals/${pending?.id}/resolve`).send({ decision: 'reject' }).expect(200);
    expect(ctx.mail.appealResults).toContainEqual({ to: malo.email, accepted: false });
    await login(malo).expect(403);
    expect((await appeal(malo).expect(429)).body.code).toBe('APPEAL_TOO_SOON');
  });

  it('ficha de cuenta y reseteo asistido: correo enmascarado y el enlace va SOLO al correo registrado', async () => {
    const card = (await soporte.agent.get(`/support/users?tag=@${dani.tag}`).expect(200)).body as SupportUserDto;
    expect(card).toMatchObject({ id: dani.id, tag: dani.tag, status: 'active', emailMasked: 'd***@example.com', emailVerified: true });
    expect(JSON.stringify(card)).not.toContain(dani.email);
    await soporte.agent.get('/support/users?tag=no.existe').expect(404);
    await soporte.agent.get('/support/users?tag=x').expect(400);

    const before = ctx.mail.resets.length;
    const response = await soporte.agent.post(`/support/users/${dani.id}/password-reset`).expect(202);
    expect(JSON.stringify(response.body)).not.toMatch(/token/i);
    expect(ctx.mail.resets.length).toBe(before + 1);
    expect(ctx.mail.resets.at(-1)?.to).toBe(dani.email);
    expect((await soporte.agent.post(`/support/users/${malo.id}/password-reset`).expect(409)).body.code).toBe('ACCOUNT_BANNED');
    expect((await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'support.password_reset'))).length).toBe(1);
  });

  it('estadísticas: solo conteos agregados', async () => {
    const stats = (await soporte.agent.get('/support/stats').expect(200)).body as SupportStatsDto;
    expect(Object.keys(stats).sort()).toEqual(['activity', 'generatedAt', 'moderation', 'users']);
    expect(stats.users.total).toBeGreaterThanOrEqual(6);
    expect(stats.users.banned).toBeGreaterThanOrEqual(1);
    expect(stats.activity.messagesLast7d).toBeGreaterThanOrEqual(2);
    expect(stats.moderation.bansLast30d).toBeGreaterThanOrEqual(2);
    for (const group of [stats.users, stats.activity, stats.moderation]) {
      for (const value of Object.values(group)) expect(typeof value).toBe('number');
    }
    const text = JSON.stringify(stats);
    for (const user of [ana, malo, soporte]) {
      expect(text).not.toContain(user.tag);
      expect(text).not.toContain(user.id);
    }
  });

  it('la evidencia de denuncias resueltas se borra pasado el plazo de retención', async () => {
    // malo quedó dado de baja en la prueba anterior: se reactiva a mano para que pueda escribir.
    await ctx.app.get(UsersRepository).update(malo.id, { status: 'active' });
    await malo.agent.post('/auth/login').send({ identifier: malo.tag, password: malo.password }).expect(200);
    const insult = ((await malo.agent.post(`/chats/${chatAnaMalo}/messages`).send({ body: 'otro' }).expect(201)).body as MessageDto).id;
    const id = await report(ana, malo, { evidence: [{ type: 'message', id: insult }] });
    const cleanup = ctx.app.get(SupportCleanupService);
    expect(await cleanup.run()).toBe(0); // pendiente: nunca se borra
    await ctx.db.update(reports).set({ status: 'confirmed', reviewedAt: new Date(Date.now() - 181 * 24 * 60 * 60 * 1000) }).where(eq(reports.id, id));
    await cleanup.run();
    expect(await ctx.db.select().from(reportEvidence).where(eq(reportEvidence.reportId, id))).toEqual([]);
  });
});
