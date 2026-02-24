import { Controller, Post, Delete, Get, Body, Param, UseGuards } from '@nestjs/common';
import { SubscriberService } from './subscriber.service';
import { CreateSubscriberDto } from './dto/create-subscriber.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('subscribers')
export class SubscriberController {
    constructor(private readonly subscriberService: SubscriberService) { }

    // Public — anyone can subscribe
    @Post()
    subscribe(@Body() dto: CreateSubscriberDto) {
        return this.subscriberService.subscribe(dto);
    }

    // Public — unsubscribe by email
    @Delete(':email')
    unsubscribe(@Param('email') email: string) {
        return this.subscriberService.unsubscribe(email);
    }

    // Admin only — list all subscribers
    @UseGuards(JwtAuthGuard)
    @Get()
    findAll() {
        return this.subscriberService.findAll();
    }

    // Admin only — get count
    @UseGuards(JwtAuthGuard)
    @Get('count')
    getCount() {
        return this.subscriberService.getActiveCount();
    }
}
