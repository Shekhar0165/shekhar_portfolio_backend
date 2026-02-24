import { IsString, IsEmail, IsNotEmpty, IsBoolean, IsOptional } from 'class-validator';

export class CreateMessageDto {
    @IsString()
    @IsNotEmpty()
    name!: string;

    @IsEmail()
    email!: string;

    @IsString()
    @IsNotEmpty()
    subject!: string;

    @IsString()
    @IsNotEmpty()
    message!: string;
}

export class UpdateMessageDto {
    @IsOptional()
    @IsBoolean()
    read?: boolean;
}
