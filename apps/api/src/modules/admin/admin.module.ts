import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { QueuesBoard } from './queues-board.js';

@Module({ controllers: [AdminController], providers: [AdminService, QueuesBoard] })
export class AdminModule {}
