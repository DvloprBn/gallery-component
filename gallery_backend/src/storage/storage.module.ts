import { Global, Logger, Module } from '@nestjs/common';
import { CloudinaryStorageDriver } from './cloudinary-storage.driver';
import { DiskStorageDriver } from './disk-storage.driver';
import { STORAGE_DRIVER } from './storage-driver.interface';
import { StorageService } from './storage.service';

/**
 * Elige el driver de almacenamiento según `STORAGE_DRIVER` y lo expone de
 * forma global vía `StorageService`.
 */
@Global()
@Module({
  providers: [
    DiskStorageDriver,
    CloudinaryStorageDriver,
    {
      provide: STORAGE_DRIVER,
      inject: [DiskStorageDriver, CloudinaryStorageDriver],
      useFactory: (disk: DiskStorageDriver, cloudinary: CloudinaryStorageDriver) => {
        const logger = new Logger('StorageModule');
        const chosen =
          process.env.STORAGE_DRIVER === 'cloudinary' ? cloudinary : disk;
        logger.log(`Driver de almacenamiento activo: ${chosen.name}`);
        return chosen;
      },
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
