import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../core/auth/auth.decorators';
import { AuthUser } from '../../core/auth/auth.types';
import { Paginated } from '../../core/pagination/pagination';
import { ParseObjectIdPipe } from '../../core/validation/parse-object-id.pipe';
import {
  CreateNoteDto,
  ListNotesQueryDto,
  NotePageDto,
  NoteResponseDto,
  UpdateNoteDto,
} from './dto/note.dto';
import { NotesService } from './notes.service';

/** Thin by design: parse, authorize via guards, delegate. */
@ApiTags('notes')
@ApiBearerAuth()
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Post()
  @ApiCreatedResponse({ type: NoteResponseDto })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateNoteDto,
  ): Promise<NoteResponseDto> {
    return this.notes.create(user.id, dto);
  }

  @Get()
  @ApiOkResponse({ type: NotePageDto })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListNotesQueryDto,
  ): Promise<Paginated<NoteResponseDto>> {
    return this.notes.list(user.id, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: NoteResponseDto })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<NoteResponseDto> {
    return this.notes.get(user.id, id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: NoteResponseDto })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateNoteDto,
  ): Promise<NoteResponseDto> {
    return this.notes.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    return this.notes.remove(user.id, id);
  }
}
