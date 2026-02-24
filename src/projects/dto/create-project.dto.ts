import { IsString, IsOptional, IsArray, IsBoolean, IsUrl } from 'class-validator';

export class CreateProjectDto {
    @IsString()
    title!: string;

    @IsString()
    description!: string;

    @IsOptional()
    @IsString()
    shortDesc?: string;

    @IsOptional()
    @IsString()
    stack?: string;

    @IsOptional()
    @IsString()
    imageUrl?: string;

    @IsOptional()
    @IsUrl()
    githubUrl?: string;

    @IsOptional()
    @IsUrl()
    liveUrl?: string;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    technologies?: string[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    highlights?: string[];

    @IsOptional()
    @IsBoolean()
    featured?: boolean;
}

