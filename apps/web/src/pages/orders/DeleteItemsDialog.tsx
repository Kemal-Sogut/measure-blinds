// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * "Are you sure?" step in front of every line-item delete in the order
 * editor — the row's own Delete button and the toolbar's bulk Delete
 * both route through it, so neither path can drop items on a single
 * stray tap (the editor is used one-handed on site, where a mis-tap
 * on a small trash icon is the common case, not the exception).
 *
 * Wording follows what is being removed: one item is named exactly as
 * its row reads ("Delete "Kitchen — Roller"?"), several are counted
 * ("3 items will be deleted"). Naming a lone item lets the user catch a
 * tap on the wrong row; counting a selection lets them catch a stale
 * checkbox they forgot was ticked.
 *
 * Purely presentational: the caller owns which keys are pending and
 * performs the removal in `onConfirm`. Deleting here only edits the
 * draft list — nothing reaches the server until the order is saved —
 * so the copy deliberately does not claim the action is irreversible.
 */

import { Button, Modal } from '../../components/ui';

/**
 * Renders the confirmation while `count > 0` and nothing otherwise.
 *
 * `itemName` is used only when `count === 1`; pass the row's display
 * name (`lineItemName`) so the prompt matches what the user clicked.
 */
export default function DeleteItemsDialog({
  count,
  itemName,
  onConfirm,
  onCancel,
}: {
  /** Number of items pending deletion; 0 keeps the dialog closed. */
  count: number;
  /** Display name of the single pending item; ignored for a multi-delete. */
  itemName?: string;
  /** Performs the deletion; the caller also clears its pending state. */
  onConfirm: () => void;
  /** Dismisses without deleting (Cancel, the close button, Escape, backdrop). */
  onCancel: () => void;
}) {
  const single = count === 1;
  return (
    <Modal
      open={count > 0}
      onClose={onCancel}
      size="sm"
      title={single ? 'Delete this item?' : `Delete ${count} items?`}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {single ? 'Delete item' : `Delete ${count} items`}
          </Button>
        </>
      }
    >
      <p className="text-[14px] text-text-secondary">
        {single ? (
          <>
            Do you want to delete{' '}
            <span className="font-semibold text-text-primary">
              {itemName ? `“${itemName}”` : 'this item'}
            </span>
            ?
          </>
        ) : (
          <>
            <span className="font-semibold text-text-primary">{count} items</span> will be
            deleted. Do you want to go ahead?
          </>
        )}
      </p>
    </Modal>
  );
}
