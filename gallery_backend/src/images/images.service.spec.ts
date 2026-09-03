import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { AlbumsService } from '../albums/albums.service';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import { ImagesService } from './images.service';

const actor: AuthenticatedUser = {
  userId: 'u1',
  email: 'a@b.com',
  roleName: 'usuario',
  roleLevel: 0,
  mustChangePassword: false,
  totpEnabled: false,
};

describe('ImagesService.setStatusBulk', () => {
  let prisma: {
    images: { findMany: jest.Mock; updateMany: jest.Mock };
  };
  let albums: { getOwned: jest.Mock };
  let service: ImagesService;

  beforeEach(() => {
    prisma = {
      images: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    albums = { getOwned: jest.fn().mockResolvedValue({ album_id: 'alb1' }) };
    service = new ImagesService(
      prisma as unknown as PrismaService,
      {} as never,
      {} as never,
      {} as never,
      albums as unknown as AlbumsService,
    );
  });

  it('cambia el estado si todas las imágenes son del álbum', async () => {
    prisma.images.findMany.mockResolvedValue([
      { image_id: 'i1' },
      { image_id: 'i2' },
    ]);

    const result = await service.setStatusBulk('alb1', actor, {
      imageIds: ['i1', 'i2'],
      status: 'published',
    });

    expect(albums.getOwned).toHaveBeenCalledWith('alb1', actor);
    expect(prisma.images.updateMany).toHaveBeenCalledWith({
      where: { album_id: 'alb1', image_id: { in: ['i1', 'i2'] } },
      data: { status: 'published' },
    });
    expect(result).toEqual({ ok: true, updated: 2 });
  });

  it('rechaza si algún id no pertenece al álbum (sin escribir)', async () => {
    prisma.images.findMany.mockResolvedValue([{ image_id: 'i1' }]); // falta 'ajeno'

    await expect(
      service.setStatusBulk('alb1', actor, {
        imageIds: ['i1', 'ajeno'],
        status: 'archived',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.images.updateMany).not.toHaveBeenCalled();
  });
});
