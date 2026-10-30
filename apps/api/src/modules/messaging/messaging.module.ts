import { Module } from '@nestjs/common';
import { MessagingController } from './messaging.controller.js';
import { MessagingService } from './messaging.service.js';
import { OffersService } from './offers.service.js';

@Module({
  controllers: [MessagingController],
  providers: [MessagingService, OffersService],
})
export class MessagingModule {}
