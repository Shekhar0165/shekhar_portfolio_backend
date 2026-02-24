import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Category, CategoryDocument } from './schemas/category.schema';
import { CreateCategoryDto } from './dto/create-category.dto';

@Injectable()
export class CategoryService {
    constructor(@InjectModel(Category.name) private categoryModel: Model<CategoryDocument>) { }

    async create(dto: CreateCategoryDto): Promise<Category> {
        const existing = await this.categoryModel.findOne({ slug: dto.slug }).exec();
        if (existing) throw new ConflictException('Category already exists');
        return new this.categoryModel(dto).save();
    }

    async findAll(): Promise<Category[]> {
        return this.categoryModel.find().sort({ order: 1, name: 1 }).exec();
    }

    async remove(id: string): Promise<Category> {
        const deleted = await this.categoryModel.findByIdAndDelete(id).exec();
        if (!deleted) throw new NotFoundException('Category not found');
        return deleted;
    }
}
