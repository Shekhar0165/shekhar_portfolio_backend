import { Controller, Post, Body, Get } from '@nestjs/common';

interface ContactDto {
    name: string;
    email: string;
    message: string;
}

@Controller('contact')
export class PortfolioContactController {
    @Post()
    receiveMessage(@Body() body: ContactDto) {
        console.log('📬 New contact message:');
        console.log(`   From: ${body.name} <${body.email}>`);
        console.log(`   Message: ${body.message}`);

        return { success: true, message: 'Message received!' };
    }
}

@Controller('health')
export class HealthController {
    @Get()
    health() {
        return { status: 'ok', uptime: process.uptime() };
    }
}
