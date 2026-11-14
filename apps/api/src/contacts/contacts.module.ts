import { Module } from '@nestjs/common';
import { BlocksModule } from '../blocks/blocks.module';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';

@Module({ imports: [BlocksModule], controllers: [ContactsController], providers: [ContactsService] })
export class ContactsModule {}
