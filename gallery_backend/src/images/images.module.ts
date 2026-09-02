import { Module } from '@nestjs/common';
import { AlbumsModule } from '../albums/albums.module';
import { MediaProcessingModule } from '../media-processing/media-processing.module';
import { ImagesController } from './images.controller';
import { ImagesService } from './images.service';

@Module({
  imports: [AlbumsModule, MediaProcessingModule],
  controllers: [ImagesController],
  providers: [ImagesService],
})
export class ImagesModule {}
