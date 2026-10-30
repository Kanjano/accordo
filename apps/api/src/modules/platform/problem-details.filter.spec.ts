import { ConflictException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { toProblem } from './problem-details.filter.js';

describe('toProblem', () => {
  it('maps HttpException status to a stable code', () => {
    expect(toProblem(new NotFoundException(), '/x')).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      instance: '/x',
    });
  });

  it('lets domain errors override the code', () => {
    const p = toProblem(new ConflictException({ code: 'LISTING_NOT_AVAILABLE', detail: 'gone' }));
    expect(p).toMatchObject({ status: 409, code: 'LISTING_NOT_AVAILABLE', detail: 'gone' });
  });

  it('maps ZodError to 400 with field errors', () => {
    const err = z.object({ price: z.number() }).safeParse({ price: 'x' }).error;
    expect(toProblem(err)).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'price' }],
    });
  });

  it('hides unknown errors behind a generic 500', () => {
    expect(toProblem(new Error('db password leaked'))).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      code: 'INTERNAL',
      instance: undefined,
    });
  });
});
