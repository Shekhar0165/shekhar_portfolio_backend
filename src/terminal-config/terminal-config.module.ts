import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TerminalConfigService } from './terminal-config.service';
import { TerminalConfigController } from './terminal-config.controller';
import { TerminalConfig, TerminalConfigSchema } from './schemas/terminal-config.schema';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: TerminalConfig.name, schema: TerminalConfigSchema }]),
    ],
    controllers: [TerminalConfigController],
    providers: [TerminalConfigService],
})
export class TerminalConfigModule { }
