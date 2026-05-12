import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class GenerateAiBlogDto {
    @IsOptional()
    @IsString()
    seedTopic?: string;

    @IsOptional()
    @IsString()
    forceCategory?: string;

    @IsOptional()
    @IsBoolean()
    autoPublish?: boolean;
}
