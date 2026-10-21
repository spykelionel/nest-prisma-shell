import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { NoteStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import {
  PageMetaDto,
  PaginationQueryDto,
} from '../../../core/pagination/pagination';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** POST /v1/notes */
export class CreateNoteDto {
  @ApiProperty({ minLength: 1, maxLength: 200, example: 'Groceries' })
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  title: string;

  @ApiProperty({ maxLength: 10000, example: 'Milk, eggs' })
  @IsString()
  @MaxLength(10000)
  body: string;
}

/** PATCH /v1/notes/:id — every field optional, at least one expected. */
export class UpdateNoteDto extends PartialType(CreateNoteDto) {
  @ApiPropertyOptional({ enum: NoteStatus })
  @IsOptional()
  @IsEnum(NoteStatus)
  status?: NoteStatus;
}

export const NOTE_SORT_FIELDS = ['createdAt', 'updatedAt'] as const;
export type NoteSortField = (typeof NOTE_SORT_FIELDS)[number];

/** GET /v1/notes */
export class ListNotesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: NoteStatus })
  @IsOptional()
  @IsEnum(NoteStatus)
  status?: NoteStatus;

  @ApiPropertyOptional({ enum: NOTE_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(NOTE_SORT_FIELDS)
  sortBy: NoteSortField = 'createdAt';
}

/** Public representation. Internal fields (deletedAt) never leave the service. */
export class NoteResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() ownerId: string;
  @ApiProperty() title: string;
  @ApiProperty() body: string;
  @ApiProperty({ enum: NoteStatus }) status: NoteStatus;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class NotePageDto {
  @ApiProperty({ type: [NoteResponseDto] }) items: NoteResponseDto[];
  @ApiProperty({ type: PageMetaDto }) meta: PageMetaDto;
}
