import { maskEmail } from '../src/mail/smtp-mail.service';

describe('Enmascarado de correos en logs', () => {
  it('oculta la parte local salvo el primer carácter y conserva el dominio', () => {
    expect(maskEmail('emmanuel@gmail.com')).toBe('e***@gmail.com');
    expect(maskEmail('a@b.com')).toBe('a***@b.com');
  });

  it('nunca deja ver la parte local completa', () => {
    const masked = maskEmail('secreto.largo@ejemplo.com.ar');
    expect(masked).not.toContain('secreto');
    expect(masked.endsWith('@ejemplo.com.ar')).toBe(true);
  });
});
