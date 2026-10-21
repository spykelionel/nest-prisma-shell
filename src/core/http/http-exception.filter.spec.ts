import {
  ArgumentsHost,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requestContext } from '../context/request-context';
import { HttpExceptionFilter } from './http-exception.filter';

function mockHost() {
  const res = {
    headersSent: false,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const req = { method: 'GET', originalUrl: '/v1/notes?page=2' };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  it('keeps a code thrown by a feature module', () => {
    const { host, res } = mockHost();
    filter.catch(
      new NotFoundException({
        code: 'NOTE_NOT_FOUND',
        message: 'Note not found',
      }),
      host,
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 404,
      success: false,
      message: 'Note not found',
      code: 'NOTE_NOT_FOUND',
      data: null,
    });
  });

  it('turns ValidationPipe output into details', () => {
    const { host, res } = mockHost();
    filter.catch(
      new BadRequestException([
        'title should not be empty',
        'body must be a string',
      ]),
      host,
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: ['title should not be empty', 'body must be a string'],
      }),
    );
  });

  it('hides the cause of unknown errors and returns the traceId', () => {
    const { host, res } = mockHost();
    requestContext.run({ traceId: 'trace-12345678' }, () =>
      filter.catch(new Error('connection string with password'), host),
    );
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      traceId: 'trace-12345678',
    });
    expect(JSON.stringify(body)).not.toContain('password');
  });

  it('maps a Prisma unique violation to 409', () => {
    const { host, res } = mockHost();
    filter.catch(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
      host,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('CONFLICT');
  });

  it('does not write twice when headers were already sent', () => {
    const { host, res } = mockHost();
    res.headersSent = true;
    filter.catch(new Error('late'), host);
    expect(res.json).not.toHaveBeenCalled();
  });
});
