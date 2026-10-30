import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import PickupItemPhoto from './PickupItemPhoto';
const id = '64b000000000000000000001';
const item = { id: '64a000000000000000000001', name: 'Local chair', imageAvailability: 'ready', coverImage: { id,
  thumbnail: { url: `/api/item-images/${id}/thumbnail`, width: 400, height: 300 } } };
test('loads one bounded thumbnail with meaningful alt text and no gallery or automatic retry', () => {
  const { rerender } = render(<><PickupItemPhoto item={item} /><button>Accept pickup</button></>);
  const image = screen.getByRole('img', { name: 'Local chair (current cover)' });
  expect(image).toHaveAttribute('src', item.coverImage.thumbnail.url); expect(image).not.toHaveAttribute('srcset');
  expect(screen.getByRole('status')).toHaveTextContent('Loading'); fireEvent.load(image); expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.error(image); expect(screen.getByText('Photo unavailable')).toBeVisible(); expect(screen.getByRole('button', { name: 'Accept pickup' })).toBeEnabled();
  rerender(<><PickupItemPhoto item={item} /><button>Accept pickup</button></>); expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
test('none, unavailable and absent legacy summaries stay distinct without adding controls', () => {
  const { rerender } = render(<PickupItemPhoto item={{ ...item, imageAvailability: 'none', coverImage: null }} />); expect(screen.getByText('No photo')).toBeVisible();
  rerender(<PickupItemPhoto item={{ ...item, imageAvailability: 'unavailable', coverImage: null }} />); expect(screen.getByText('Photo unavailable')).toBeVisible();
  rerender(<PickupItemPhoto item={{ id: item.id, name: item.name }} />); expect(screen.queryByText(/photo/i)).not.toBeInTheDocument(); expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
test('D1 media validation rejects arbitrary provider URLs and private metadata', () => {
  const { rerender } = render(<PickupItemPhoto item={{ ...item, coverImage: { ...item.coverImage, thumbnail: { ...item.coverImage.thumbnail, url: 'https://provider.invalid/private' } } }} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument(); expect(screen.getByText('Photo unavailable')).toBeVisible();
  rerender(<PickupItemPhoto item={{ ...item, coverImage: { ...item.coverImage, ownerId: 'PRIVATE' } }} />); expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
test('request creation derives only the first validated thumbnail from the public detail gallery DTO', () => {
  const value = { ...item, coverImage: undefined, images: [{ ...item.coverImage, display: { url: `/api/item-images/${id}/display`, width: 1200, height: 900 } }] };
  render(<PickupItemPhoto item={value} detail />);
  expect(screen.getByRole('img')).toHaveAttribute('src', item.coverImage.thumbnail.url); expect(document.querySelector('img[src$="/display"]')).not.toBeInTheDocument();
});
