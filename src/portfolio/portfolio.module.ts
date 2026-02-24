import { Module } from '@nestjs/common';
import { PortfolioContactController, HealthController } from './portfolio.controller';

@Module({
    controllers: [PortfolioContactController, HealthController],
})
export class PortfolioModule { }
