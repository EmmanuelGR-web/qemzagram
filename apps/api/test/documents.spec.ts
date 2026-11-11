import { eq } from 'drizzle-orm';
import type { MessageDto } from '@qemzagram/shared';
import { attachments } from '../src/database/schema';
import { sanitizeFileName } from '../src/media/media-processor.service';
import { binary } from './support/files';
import { createTestApp, signUp, type TestContext, type TestUser } from './support/test-app';

/** ZIP mínimo "stored" (sin compresión) con las entradas indicadas. Alcanza para probar la validación. */
function fakeZip(entries: Record<string, string>): Buffer {
  const parts = Object.entries(entries).map(([name, content]) => {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // firma "PK\x03\x04"
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(Buffer.byteLength(content), 18);
    header.writeUInt32LE(Buffer.byteLength(content), 22);
    header.writeUInt16LE(Buffer.byteLength(name), 26);
    return Buffer.concat([header, Buffer.from(name), Buffer.from(content)]);
  });
  return Buffer.concat(parts);
}

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF');
const DOCX = fakeZip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document/>' });

describe('Adjuntos: documentos', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let chatId: string;

  const sendFile = (data: Buffer, filename: string, contentType = 'application/octet-stream') =>
    ana.agent.post(`/chats/${chatId}/attachments`).field('kind', 'file').attach('file', data, { filename, contentType });

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.docs', 'An#Docs2026-clave');
    beto = await signUp(ctx, 'beto.docs', 'Be#Docs2026-clave');
    await ana.agent.post('/contacts').send({ tag: 'beto.docs' }).expect(201);
    chatId = ((await ana.agent.post('/chats/direct').send({ tag: 'beto.docs' }).expect(200)).body as { id: string }).id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('envía un PDF: se descarga (nunca se abre en la app) con su nombre original', async () => {
    const sent = await sendFile(PDF, 'Apuntes de Programación ñandú.pdf', 'application/pdf').expect(201);
    const attachment = (sent.body as MessageDto).attachment;
    expect(attachment).toMatchObject({ kind: 'file', mimeType: 'application/pdf', name: 'Apuntes de Programación ñandú.pdf', size: PDF.length });

    const download = await beto.agent.get(attachment?.url ?? '').buffer(true).parse(binary).expect(200);
    expect(download.headers['content-type']).toBe('application/pdf');
    expect(download.headers['content-disposition']).toMatch(/^attachment; filename="Apuntes de Programaci_n _and_\.pdf"; filename\*=UTF-8''Apuntes%20de%20Programaci%C3%B3n/);
    expect(download.headers['content-security-policy']).toContain('sandbox');
    expect((download.body as Buffer).equals(PDF)).toBe(true);

    // el nombre original se guarda cifrado
    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, attachment?.id ?? ''));
    expect(row?.nameEncrypted).toBeTruthy();
    expect(row?.nameEncrypted).not.toContain('Apuntes');
  });

  it('acepta Office moderno, texto y CSV, y les asigna el tipo según la extensión validada', async () => {
    const docx = await sendFile(DOCX, 'tp-final.docx').expect(201);
    expect((docx.body as MessageDto).attachment?.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const txt = await sendFile(Buffer.from('Hola, esto es texto plano con tildes: áéí\n'), 'notas.txt').expect(201);
    expect((txt.body as MessageDto).attachment?.mimeType).toBe('text/plain; charset=utf-8');
    await sendFile(Buffer.from('nombre,tag\nAna,ana.docs\n'), 'agenda.csv').expect(201);
  });

  it('rechaza ejecutables, HTML/SVG, extensiones que no coinciden con el contenido y macros', async () => {
    const reject = async (data: Buffer, name: string, code: string) => {
      const response = await sendFile(data, name).expect(400);
      expect(response.body.code).toBe(code);
    };
    await reject(Buffer.from('MZ\x90\x00\x03\x00 programa'), 'juego.exe', 'UNSUPPORTED_FILE'); // binario desconocido
    await reject(Buffer.from('<html><script>alert(1)</script></html>'), 'pagina.html', 'UNSUPPORTED_FILE');
    await reject(Buffer.from('<svg onload="alert(1)"/>'), 'dibujo.svg', 'UNSUPPORTED_FILE');
    await reject(Buffer.from('echo hola'), 'script.sh', 'UNSUPPORTED_FILE');
    await reject(Buffer.from('<html><script>alert(1)</script></html>'), 'falso.pdf', 'FILE_MISMATCH'); // texto disfrazado de PDF
    await reject(PDF, 'disfrazado.docx', 'FILE_MISMATCH');
    await reject(fakeZip({ 'virus.exe': 'MZ' }), 'trabajo.docx', 'FILE_MISMATCH'); // ZIP que no es Office
    await reject(fakeZip({ '[Content_Types].xml': '<Types/>', 'word/vbaProject.bin': 'macros' }), 'con-macros.docx', 'FILE_MISMATCH');
    await reject(PDF, 'sin-extension', 'UNSUPPORTED_FILE');
  });

  it('limpia nombres peligrosos', () => {
    expect(sanitizeFileName('../../etc/passwd.txt')).toBe('passwd.txt');
    expect(sanitizeFileName('C:\\Windows\\system32\\informe.pdf')).toBe('informe.pdf');
    expect(sanitizeFileName('foto\u202Egpj.exe')).toBe('fotogpj.exe'); // sin caracteres que invierten el texto
    expect(sanitizeFileName('...oculto.txt')).toBe('oculto.txt');
    expect(sanitizeFileName('   ')).toBe('archivo');
    const long = sanitizeFileName(`${'a'.repeat(300)}.pdf`);
    expect(long.length).toBe(120);
    expect(long.endsWith('.pdf')).toBe(true);
  });
});
