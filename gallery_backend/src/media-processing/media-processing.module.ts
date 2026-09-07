import { Module } from '@nestjs/common';
import { ImagePipelineService } from './image-pipeline.service';
import { VideoPipelineService } from './video-pipeline.service';

@Module({
  providers: [ImagePipelineService, VideoPipelineService],
  exports: [ImagePipelineService, VideoPipelineService],
})
export class MediaProcessingModule {}
