'use client';

import { useState } from 'react';
import type { Gallery, GalleryMedia } from '@/lib/gallery-schema';
import { BookLayout } from './BookLayout';
import { Lightbox } from './Lightbox';

/**
 * El fotolibro de portada de `/trabajo` (Fase 15e): monta `BookLayout` en modo
 * "libro" sobre un conjunto de elementos que **no** vienen de un solo álbum
 * (los devuelve `GET /showcase`), y le conecta el lightbox — igual que hace
 * `GalleryView` para la galería de un álbum.
 *
 * @param props.media - Los elementos ya ordenados para hojear (foto + video).
 * @param props.title - Título de la portada del libro (el nombre del sitio).
 */
export function ShowcaseBook({
  media,
  title,
}: {
  media: GalleryMedia[];
  title: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  // Álbum sintético: `/showcase` no es una colección, pero `BookLayout` espera
  // la forma de una galería. Sin descripción (la portada solo lleva el título),
  // tema por defecto (los elementos son de colecciones distintas), y
  // `layout: 'book'` para que `BookLayout` no caiga a otro modo.
  const gallery: Gallery = {
    album: {
      title,
      description: null,
      slug: '',
      layout: 'book',
      theme: {},
      visibility: 'public',
      mediaCount: media.length,
    },
    media,
  };

  return (
    <div className="pf-showcase">
      <BookLayout gallery={gallery} onOpen={setOpenIndex} />
      <Lightbox media={media} index={openIndex} onIndexChange={setOpenIndex} />
    </div>
  );
}
