import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
    constructor(
        private configService: ConfigService,
        private jwtService: JwtService,
    ) { }

    async login(loginDto: LoginDto) {
        const adminUsername = this.configService.get<string>('ADMIN_USERNAME');
        const adminPassword = this.configService.get<string>('ADMIN_PASSWORD');

        if (
            loginDto.username === adminUsername &&
            loginDto.password === adminPassword
        ) {
            const payload = { username: loginDto.username, sub: 'admin' };
            return {
                access_token: this.jwtService.sign(payload),
            };
        }

        throw new UnauthorizedException('Invalid credentials');
    }
}
