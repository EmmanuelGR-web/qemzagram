import sharp from 'sharp';
import { messages } from '../src/database/schema';
import { createTestApp, signUp, type TestContext, type TestUser } from './support/test-app';

describe('Perfil, agenda y chats', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let carla: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.perfil', 'An#Perfil2026-clave');
    beto = await signUp(ctx, 'beto.chat', 'Be#Chatea2026-clave');
    carla = await signUp(ctx, 'carla.chat', 'Ca#Chatea2026-clave');
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('perfil', () => {
    it('actualiza datos y valida los campos', async () => {
      const updated = await ana.agent.patch('/users/me').send({ displayName: 'Ana Gómez', bio: 'Hola, uso Qemzagram', isPrivate: true }).expect(200);
      expect(updated.body).toMatchObject({ displayName: 'Ana Gómez', isPrivate: true });
      await ana.agent.patch('/users/me').send({ bio: 'x'.repeat(200) }).expect(400);
      await ana.agent.patch('/users/me').send({ role: 'support' }).expect(400); // no se puede escalar privilegios
      await ana.agent.patch('/users/me').send({ isPrivate: false }).expect(200);
    });

    it('procesa foto de perfil y portada, y rechaza archivos que no son imágenes', async () => {
      const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#d91e36' } }).png().toBuffer();
      const avatar = await ana.agent.post('/users/me/avatar').attach('file', png, { filename: 'foto.png', contentType: 'image/png' }).expect(200);
      expect(avatar.body.avatarUrl).toMatch(/^\/uploads\/[0-9a-f-]{36}\.webp$/);

      const file = await ctx.app.getHttpServer();
      const served = await ana.agent.get(avatar.body.avatarUrl as string).expect(200);
      expect(served.headers['content-type']).toContain('image/webp');
      expect(file).toBeDefined();

      const cover = await ana.agent.post('/users/me/cover').attach('file', png, { filename: 'portada.png', contentType: 'image/png' }).expect(200);
      expect(cover.body.coverUrl).toMatch(/^\/uploads\//);

      // un script disfrazado de imagen se rechaza por su contenido real
      await ana.agent.post('/users/me/avatar').attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'x.png', contentType: 'image/png' }).expect(400);
      await ana.agent.post('/users/me/avatar').attach('file', Buffer.from('MZ-ejecutable'), { filename: 'x.exe', contentType: 'application/octet-stream' }).expect(400);
      await ana.agent.post('/users/me/avatar').expect(400);

      const huge = Buffer.alloc(6 * 1024 * 1024, 1);
      const tooBig = await ana.agent.post('/users/me/avatar').attach('file', huge, { filename: 'grande.png', contentType: 'image/png' });
      expect(tooBig.status).toBeGreaterThanOrEqual(400);
    });

    it('oculta bio y portada de cuentas privadas a quien no está en su agenda', async () => {
      await ana.agent.patch('/users/me').send({ bio: 'Mi bio', isPrivate: true }).expect(200);
      const asStranger = await beto.agent.get('/users/by-tag/ana.perfil').expect(200);
      expect(asStranger.body.bio).toBe('');
      expect(asStranger.body.coverUrl).toBeNull();
      expect(asStranger.body.email).toBeUndefined();

      await ana.agent.post('/contacts').send({ tag: 'beto.chat' }).expect(201);
      const asContact = await beto.agent.get('/users/by-tag/ana.perfil').expect(200);
      expect(asContact.body.bio).toBe('Mi bio');
      await beto.agent.get('/users/by-tag/no.existe').expect(404);
    });
  });

  describe('agenda', () => {
    it('agrega y quita contactos por tag', async () => {
      await beto.agent.post('/contacts').send({ tag: '@carla.chat', alias: 'Carli' }).expect(201);
      await beto.agent.post('/contacts').send({ tag: 'beto.chat' }).expect(400); // a uno mismo
      await beto.agent.post('/contacts').send({ tag: 'fantasma' }).expect(404);
      const list = await beto.agent.get('/contacts').expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({ alias: 'Carli', user: { tag: 'carla.chat' } });
      expect(JSON.stringify(list.body)).not.toContain('@example.com');
      await beto.agent.delete(`/contacts/${carla.id}`).expect(204);
      await beto.agent.delete(`/contacts/${carla.id}`).expect(404);
      await beto.agent.post('/contacts').send({ tag: 'carla.chat' }).expect(201);
    });
  });

  describe('chats', () => {
    it('solo permite chatear con gente de la agenda y evita duplicar conversaciones', async () => {
      await carla.agent.post('/chats/direct').send({ tag: 'ana.perfil' }).expect(400); // no está en su agenda
      const first = await beto.agent.post('/chats/direct').send({ tag: 'carla.chat' }).expect(200);
      const second = await beto.agent.post('/chats/direct').send({ tag: 'carla.chat' }).expect(200);
      expect(second.body.id).toBe(first.body.id);
    });

    it('envía mensajes, los guarda cifrados y solo los leen los miembros', async () => {
      const chat = await beto.agent.post('/chats/direct').send({ tag: 'carla.chat' }).expect(200);
      const secret = 'Nos vemos mañana a las 9, es un secreto';
      await beto.agent.post(`/chats/${chat.body.id}/messages`).send({ body: secret }).expect(201);
      await beto.agent.post(`/chats/${chat.body.id}/messages`).send({ body: '   ' }).expect(400);
      await beto.agent.post(`/chats/${chat.body.id}/messages`).send({ body: 'x'.repeat(4001) }).expect(400);

      const history = await carla.agent.get(`/chats/${chat.body.id}/messages`).expect(200);
      expect(history.body).toHaveLength(1);
      expect(history.body[0].body).toBe(secret);

      const stored = await ctx.db.select().from(messages);
      expect(stored.length).toBeGreaterThan(0);
      for (const row of stored) expect(row.body).not.toContain('secreto'); // cifrado en la base

      const list = await carla.agent.get('/chats').expect(200);
      expect(list.body[0].lastMessage.body).toBe(secret);

      // un tercero no puede ver ni escribir, y la respuesta no revela que el chat existe
      await ana.agent.get(`/chats/${chat.body.id}/messages`).expect(404);
      await ana.agent.post(`/chats/${chat.body.id}/messages`).send({ body: 'intruso' }).expect(404);
      await ana.agent.get(`/chats/${chat.body.id}`).expect(404);
      await ana.agent.get('/chats/no-es-uuid/messages').expect(400);
    });

    it('crea grupos de hasta 10 miembros', async () => {
      const members: TestUser[] = [];
      for (let index = 0; index < 9; index += 1) members.push(await signUp(ctx, `miembro.${index}`, `Mi#Miembro2026-${index}zz`));
      const owner = await signUp(ctx, 'duenia.grupo', 'Du#Duenia2026-clave');
      const extra = await signUp(ctx, 'extra.persona', 'Ex#Extra2026-clave');
      for (const member of [...members, extra]) await owner.agent.post('/contacts').send({ tag: member.tag }).expect(201);

      await owner.agent.post('/chats/groups').send({ title: 'Demasiados', memberTags: [...members.map((m) => m.tag), extra.tag] }).expect(400);
      await owner.agent.post('/chats/groups').send({ title: 'Sin agenda', memberTags: ['ana.perfil'] }).expect(400);

      const group = await owner.agent.post('/chats/groups').send({ title: 'Equipo Qemza', memberTags: members.map((m) => m.tag) }).expect(201);
      expect(group.body.members).toHaveLength(10);
      expect(group.body.members.find((m: { user: { tag: string } }) => m.user.tag === 'duenia.grupo').role).toBe('admin');

      await owner.agent.post(`/chats/${group.body.id}/members`).send({ tag: extra.tag }).expect(400); // grupo lleno
      await members[0]!.agent.post(`/chats/${group.body.id}/messages`).send({ body: 'Hola equipo' }).expect(201);
      const seen = await members[8]!.agent.get(`/chats/${group.body.id}/messages`).expect(200);
      expect(seen.body).toHaveLength(1);

      await members[1]!.agent.delete(`/chats/${group.body.id}/members/me`).expect(204);
      await members[1]!.agent.get(`/chats/${group.body.id}/messages`).expect(404);
      await members[0]!.agent.post(`/chats/${group.body.id}/members`).send({ tag: extra.tag }).expect(400); // no es admin
      await owner.agent.post(`/chats/${group.body.id}/members`).send({ tag: extra.tag }).expect(200);
    });
  });
});
