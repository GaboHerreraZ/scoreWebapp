import { PartialType } from '@nestjs/swagger';
import { CreateBlogPostDto } from './create-blog-post.dto.js';

/** Actualización parcial de un artículo (panel admin). */
export class UpdateBlogPostDto extends PartialType(CreateBlogPostDto) {}
