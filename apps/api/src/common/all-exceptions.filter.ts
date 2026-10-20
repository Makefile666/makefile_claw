import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { error } from './response.js';

/**
 * 全局异常过滤器：将所有异常统一转为 { code, data, msg, error } 格式
 * error 字段透传错误标识（异常类名，如 NotFoundException）
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let msg = 'Internal server error';
    let code: number = status;
    let errorIdentifier = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = status;
      errorIdentifier = exception.constructor.name;
      const res = exception.getResponse();
      if (typeof res === 'string') {
        msg = res;
      } else if (res && typeof res === 'object' && 'message' in res) {
        const message = (res as { message: unknown }).message;
        msg = Array.isArray(message) ? message.join(', ') : String(message);
      }
    } else if (exception instanceof Error) {
      msg = exception.message;
      errorIdentifier = exception.name || 'Error';
    }

    this.logger.error(`${msg}`, exception instanceof Error ? exception.stack : undefined);

    response.status(status).json(error(msg, code, errorIdentifier));
  }
}
