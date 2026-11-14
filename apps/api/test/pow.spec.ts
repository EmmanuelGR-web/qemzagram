import { leadingZeroBits, POW_HEADER, sha256, solvePowChunk, type PowChallengeDto } from '@qemzagram/shared';
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { PowService } from '../src/captcha/pow.service';
import { createTestApp, ORIGIN, STRONG_PASSWORD, type TestContext } from './support/test-app';

const DIFFICULTY = 8;

describe('Prueba de trabajo anti-bots (CAPTCHA propio)', () => {
  let ctx: TestContext;

  const challenge = async (purpose: string) => (await request(ctx.app.getHttpServer()).get(`/auth/pow?purpose=${purpose}`).expect(200)).body as PowChallengeDto;
  const solve = (dto: PowChallengeDto) => {
    const nonce = solvePowChunk(dto.challenge, dto.difficulty, 0, 1_000_000);
    if (nonce === null) throw new Error('sin solución');
    return `${dto.challenge}:${nonce}`;
  };
  const login = (header?: string) => {
    const call = request(ctx.app.getHttpServer()).post('/auth/login').set('Origin', ORIGIN);
    return (header ? call.set(POW_HEADER, header) : call).send({ identifier: 'nadie.pow', password: STRONG_PASSWORD });
  };

  beforeAll(async () => {
    ctx = await createTestApp({ POW_ENABLED: 'true', POW_DIFFICULTY: String(DIFFICULTY) });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('el SHA-256 de packages/shared coincide con el de Node (vectores del NIST y datos al azar)', () => {
    const hex = (data: Uint8Array) => Buffer.from(data).toString('hex');
    expect(hex(sha256(new TextEncoder().encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(sha256(new Uint8Array(0)))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    for (const size of [1, 55, 56, 63, 64, 65, 119, 200, 1000]) {
      const data = randomBytes(size);
      expect(hex(sha256(data))).toBe(createHash('sha256').update(data).digest('hex'));
    }
    expect(leadingZeroBits(new Uint8Array([0, 0x0f, 0xff]))).toBe(12);
  });

  it('sin solución, con solución inválida o para otro propósito: 400', async () => {
    expect((await login().expect(400)).body.code).toBe('POW_REQUIRED');
    await login('basura').expect(400);
    const dto = await challenge('login');
    expect(dto.difficulty).toBe(DIFFICULTY);
    // Nonce que no cumple la dificultad.
    let bad = 0;
    while (leadingZeroBits(createHash('sha256').update(`${dto.challenge}:${bad}`).digest()) >= DIFFICULTY) bad++;
    expect((await login(`${dto.challenge}:${bad}`).expect(400)).body.code).toBe('POW_INVALID');
    // Un desafío de registro no sirve para el login.
    await login(solve(await challenge('register'))).expect(400);
    // Desafío alterado (firma inválida): bajar la dificultad no sirve.
    const tampered = dto.challenge.replace(`.${DIFFICULTY}.`, '.0.');
    await login(`${tampered}:0`).expect(400);
    await request(ctx.app.getHttpServer()).get('/auth/pow?purpose=otro').expect(400);
  });

  it('con solución válida el pedido pasa (y la misma solución no sirve dos veces)', async () => {
    const header = solve(await challenge('login'));
    expect((await login(header).expect(401)).body.code).toBe('INVALID_CREDENTIALS'); // pasó el anti-bots; falla la contraseña
    expect((await login(header).expect(400)).body.code).toBe('POW_INVALID'); // repetida
  });

  it('un desafío vencido no sirve', async () => {
    const service = ctx.app.get(PowService);
    const old = service.issue('login', Date.now() - 10 * 60 * 1000);
    await login(solve(old)).expect(400);
  });

  it('el registro también lo exige', async () => {
    const server = ctx.app.getHttpServer();
    const body = { email: 'nuevo.pow@example.com', tag: 'nuevo.pow', password: 'Nu#Prueba2026-ok' };
    await request(server).post('/auth/register').set('Origin', ORIGIN).send(body).expect(400);
    await request(server).post('/auth/register').set('Origin', ORIGIN).set(POW_HEADER, solve(await challenge('register'))).send(body).expect(202);
    await request(server).post('/auth/forgot-password').set('Origin', ORIGIN).send({ email: body.email }).expect(400);
    await request(server).post('/auth/forgot-password').set('Origin', ORIGIN).set(POW_HEADER, solve(await challenge('forgot'))).send({ email: body.email }).expect(202);
  });
});
