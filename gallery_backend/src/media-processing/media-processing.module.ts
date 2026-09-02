import { Module } from '@nestjs/common';
import { ImagePipelineService } from './image-pipeline.service';

@Module({
  providers: [ImagePipelineService],
  exports: [ImagePipelineService],
})
export class MediaProcessingModule {}
