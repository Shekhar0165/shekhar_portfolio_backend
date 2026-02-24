import { IsString, IsOptional, IsArray, IsBoolean, IsUrl } from 'class-validator';

export class CreateBlogDto {
    @IsString()
    title!: string;

    @IsString()
    slug!: string;

    @IsString()
    content!: string;

    @IsString()
    excerpt!: string;

    @IsOptional()
    @IsString()
    coverImage?: string;

    @IsOptional()
    @IsBoolean()
    published?: boolean;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    seoKeywords?: string[];

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    tags?: string[];

    @IsOptional()
    @IsString()
    author?: string;

    @IsOptional()
    @IsString()
    readingTime?: string;

    @IsOptional()
    @IsString()
    metaDescription?: string;
}
