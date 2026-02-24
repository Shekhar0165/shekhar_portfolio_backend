import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SubscriberService } from './subscriber.service';
import { SubscriberController } from './subscriber.controller';
import { Subscriber, SubscriberSchema } from './schemas/subscriber.schema';

@Module({
    imports: [MongooseModule.forFeature([{ name: Subscriber.name, schema: SubscriberSchema }])],
    controllers: [SubscriberController],
    providers: [SubscriberService],
    exports: [SubscriberService],
})
export class SubscriberModule { }
