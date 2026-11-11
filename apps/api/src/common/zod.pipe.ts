import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z, ZodTypeAny } from 'zod';

/** Valida y transforma la entrada con un esquema Zod. Rechaza todo lo que no cumpla. */
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Datos inválidos',
        issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    return result.data;
  }
}
