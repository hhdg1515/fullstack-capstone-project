import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PublicItemCard from './PublicItemCard';
import PublicItemGallery from './PublicItemPhotos';
import { publicItemMedia } from '../../api/publicItemMedia';
const photo = n => { const id = n.toString(16).padStart(24, '0'); return { id, thumbnail: { url: `/api/item-images/${id}/thumbnail`, width: 400, height: 300 }, display: { url: `/api/item-images/${id}/display`, width: 800, height: 600 } }; };
const item = { id: 'a'.repeat(24), name: 'Local chair', neighborhood: 'Local area', city: 'Oakland', availability: 'now', effectiveAvailableUntil: '2099-01-01', imageAvailability: 'ready' };
const gallery = (count = 5) => ({ ...item, images: Array.from({ length: count }, (_, index) => photo(index + 1)) });
const card = value => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><PublicItemCard item={value} /></MemoryRouter>);
test('a card uses only its safe thumbnail as one linked visual anchor; a broken image preserves useful text', () => {
  const { display, ...coverImage } = photo(1); card({ ...item, coverImage });
  const link = screen.getByRole('link', { name: item.name }); expect(link).toContainElement(screen.getByRole('heading', { name: item.name }));
  const image = link.querySelector('img'); expect(image).toHaveAttribute('src', coverImage.thumbnail.url); expect(image).toHaveAttribute('loading', 'lazy'); expect(image).toHaveAttribute('alt', '');
  expect(document.querySelectorAll('img')).toHaveLength(1); expect(document.querySelector('[src$="/display"]')).not.toBeInTheDocument();
  fireEvent.error(image); expect(screen.getByText('Photo unavailable')).toBeVisible(); expect(screen.getByText('Local area, Oakland')).toBeVisible(); expect(link).toHaveAttribute('href', '/app/items/' + item.id);
});
test('known no-photo cards use a neutral text state and legacy responses stay text-first', () => {
  const { rerender } = card({ ...item, imageAvailability: 'none', coverImage: null }); expect(screen.getByText('No photo')).toBeVisible(); expect(document.querySelector('img')).not.toBeInTheDocument();
  rerender(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><PublicItemCard item={{ ...item, imageAvailability: undefined }} /></MemoryRouter>);
  expect(screen.queryByText('No photo')).not.toBeInTheDocument(); expect(screen.getByRole('link', { name: item.name })).toBeVisible();
});
test('one photo loads one display without unnecessary navigation', () => {
  render(<PublicItemGallery item={gallery(1)} />); const image = screen.getByRole('img', { name: 'Local chair (1 of 1)' });
  expect(image).toHaveAttribute('src', photo(1).display.url); expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Loading photo'); fireEvent.load(image); expect(screen.queryByText('Loading photo…')).not.toBeInTheDocument();
});
test('five-photo gallery loads only the chosen display, with native and arrow/Home/End keyboard navigation', () => {
  render(<PublicItemGallery item={gallery()} />);
  expect(document.querySelectorAll('img[src$="/display"]')).toHaveLength(1); expect(document.querySelectorAll('img[src$="/thumbnail"]')).toHaveLength(5);
  expect(screen.getByRole('button', { name: 'Previous photo' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Next photo' }));
  expect(screen.getByRole('img', { name: 'Local chair (2 of 5)' })).toHaveAttribute('src', photo(2).display.url);
  const second = screen.getByRole('button', { name: 'Show photo 2 of 5' }); second.focus(); fireEvent.keyDown(second, { key: 'End' });
  expect(screen.getByRole('button', { name: 'Show photo 5 of 5' })).toHaveFocus(); expect(screen.getByRole('button', { name: 'Next photo' })).toBeDisabled();
  fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' }); expect(screen.getByRole('img', { name: 'Local chair (4 of 5)' })).toHaveAttribute('src', photo(4).display.url);
  fireEvent.keyDown(document.activeElement, { key: 'Home' }); expect(screen.getByRole('button', { name: 'Show photo 1 of 5' })).toHaveFocus();
});
test('missing variants retain navigation and text; render cycles cannot automatically retry a failed image', () => {
  const value = gallery(); const { rerender } = render(<><p>Item information stays available.</p><PublicItemGallery item={value} /></>);
  fireEvent.error(screen.getByRole('img', { name: 'Local chair (1 of 5)' }));
  expect(screen.getByText(/Photo unavailable. Choose another/)).toBeVisible(); expect(screen.getByText('Item information stays available.')).toBeVisible();
  rerender(<><p>Item information stays available.</p><PublicItemGallery item={value} /></>); expect(document.querySelector('img[src$="/display"]')).not.toBeInTheDocument();
  const button = screen.getByRole('button', { name: 'Show photo 3 of 5' }); fireEvent.error(button.querySelector('img'));
  expect(within(button).getByText('3')).toBeVisible(); fireEvent.click(button); expect(screen.getByRole('img', { name: 'Local chair (3 of 5)' })).toHaveAttribute('src', photo(3).display.url);
});
test('new authoritative order resets selection and removes deleted image URLs', () => {
  const value = gallery(); const { rerender } = render(<PublicItemGallery item={value} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show photo 5 of 5' }));
  rerender(<PublicItemGallery item={{ ...value, images: [photo(3), photo(2)] }} />);
  expect(screen.getByRole('img', { name: 'Local chair (1 of 2)' })).toHaveAttribute('src', photo(3).display.url);
  expect(document.querySelector(`img[src="${photo(5).display.url}"]`)).not.toBeInTheDocument();
});
test.each(['https://provider.invalid/private?token=secret', '//provider.invalid/x', 'data:image/png;base64,abc', 'javascript:alert(1)', photo(1).display.url, photo(2).thumbnail.url, photo(1).thumbnail.url + '?key=secret'])('rejects untrusted cover URL %s without hiding the listing', url => {
  const { display, ...coverImage } = photo(1); coverImage.thumbnail = { ...coverImage.thumbnail, url };
  card({ ...item, coverImage }); expect(document.querySelector('img')).not.toBeInTheDocument(); expect(screen.getByRole('link', { name: item.name })).toBeVisible(); expect(screen.getByText('Photo unavailable')).toBeVisible();
});
test('public media rejects oversized dimensions, duplicated IDs, excess photos and private fields', () => {
  for (const images of [[photo(1), photo(1)], Array.from({ length: 6 }, (_, index) => photo(index + 1)), [{ ...photo(1), ownerId: 'PRIVATE' }], [{ ...photo(1), display: { ...photo(1).display, width: 1281 } }]]) {
    expect(publicItemMedia({ ...item, images }, true).imageAvailability).toBe('unavailable');
  }
  expect(publicItemMedia({ ...item, imageAvailability: 'none', images: [photo(1)] }, true).imageAvailability).toBe('unavailable');
  render(<PublicItemGallery item={{ ...item, imageAvailability: 'unavailable', images: [] }} />); expect(screen.getByText(/Photos unavailable/)).toBeVisible();
  expect(document.querySelector('img')).not.toBeInTheDocument();
});
