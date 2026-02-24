import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { CreateMessageDto, UpdateMessageDto } from './dto/create-message.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('messages')
export class MessagesController {
    constructor(private readonly messagesService: MessagesService) { }

    @Post() // Public, for the contact form
    create(@Body() createMessageDto: CreateMessageDto) {
        return this.messagesService.create(createMessageDto);
    }

    @UseGuards(JwtAuthGuard)
    @Get() // Admin only
    findAll() {
        return this.messagesService.findAll();
    }

    @UseGuards(JwtAuthGuard)
    @Patch(':id') // Admin only, e.g., marking as read
    update(@Param('id') id: string, @Body() updateMessageDto: UpdateMessageDto) {
        return this.messagesService.update(id, updateMessageDto);
    }

    @UseGuards(JwtAuthGuard)
    @Delete(':id') // Admin only
    remove(@Param('id') id: string) {
        return this.messagesService.remove(id);
    }
}
