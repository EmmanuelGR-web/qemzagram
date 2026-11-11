import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { addContactSchema, type ContactDto } from '@qemzagram/shared';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ContactsService } from './contacts.service';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ContactDto[]> {
    return this.contacts.list(user.id);
  }

  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  add(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(addContactSchema)) body: { tag: string; alias?: string },
  ): Promise<ContactDto> {
    return this.contacts.add(user.id, body.tag, body.alias);
  }

  @Delete(':contactId')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('contactId', ParseUUIDPipe) contactId: string): Promise<void> {
    return this.contacts.remove(user.id, contactId);
  }
}
