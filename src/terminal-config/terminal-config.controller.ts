import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { TerminalConfigService } from './terminal-config.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('terminal-config')
export class TerminalConfigController {
    constructor(private readonly configService: TerminalConfigService) { }

    @Get()
    getConfig() {
        return this.configService.get();
    }

    @UseGuards(JwtAuthGuard)
    @Put()
    updateConfig(@Body() body: any) {
        return this.configService.update(body);
    }
}
