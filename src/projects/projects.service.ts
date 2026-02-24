import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Project, ProjectDocument } from './schemas/project.schema';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UploadService } from '../upload/upload.service';

@Injectable()
export class ProjectsService {
    constructor(
        @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
        private readonly uploadService: UploadService,
    ) { }

    async create(createProjectDto: CreateProjectDto): Promise<Project> {
        const createdProject = new this.projectModel(createProjectDto);
        return createdProject.save();
    }

    async findAll(): Promise<Project[]> {
        return this.projectModel.find().sort({ createdAt: -1 }).exec();
    }

    async findOne(id: string): Promise<Project> {
        const project = await this.projectModel.findById(id).exec();
        if (!project) throw new NotFoundException('Project not found');
        return project;
    }

    async update(id: string, updateProjectDto: UpdateProjectDto): Promise<Project> {
        // If imageUrl is changing, delete the old one from S3
        if (updateProjectDto.imageUrl) {
            const existing = await this.projectModel.findById(id).exec();
            if (existing?.imageUrl && existing.imageUrl !== updateProjectDto.imageUrl) {
                this.uploadService.deleteByUrl(existing.imageUrl).catch(() => { });
            }
        }

        const updatedProject = await this.projectModel
            .findByIdAndUpdate(id, updateProjectDto, { new: true })
            .exec();
        if (!updatedProject) throw new NotFoundException('Project not found');
        return updatedProject;
    }

    async remove(id: string): Promise<Project> {
        const deletedProject = await this.projectModel.findByIdAndDelete(id).exec();
        if (!deletedProject) throw new NotFoundException('Project not found');
        // Delete project image from S3
        if (deletedProject.imageUrl) {
            this.uploadService.deleteByUrl(deletedProject.imageUrl).catch(() => { });
        }
        return deletedProject;
    }
}
