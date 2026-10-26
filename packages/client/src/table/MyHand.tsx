import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { kindOf, type Meld, type TileId } from "@mahjong/engine";
import { moveLoose } from "../hand/arrangement";
import { Tile } from "../Tile";
import { Melds, RevealedGroups } from "./Melds";
import type { Command, TableControls } from "./useTableControls";

interface Props {
  controls: TableControls;
  melds: Meld[];
  lastDrawn: TileId | null;
  /** Set once you've won: your hand formed up into its sets, replacing your own layout. */
  won: { groups: TileId[][]; tile: TileId } | null;
}

/**
 * Your side of the table: locked sets, then your private groups (on the left), then loose tiles you can
 * drag into any order. Clicking tiles selects them; a toolbar floats above the selection.
 */
export function MyHand({ controls, melds, lastDrawn, won }: Props) {
  const { arrangement, setArrangement, selection, selectionCommands, options, claimedTile } = controls;
  // Small movement threshold so a click still selects instead of starting a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // The toolbar sits above the middle selected tile, in display order.
  const display = [...arrangement.groups.flat(), ...arrangement.loose];
  const selectedInOrder = display.filter((t) => selection.includes(t));
  const anchor = selectedInOrder[Math.floor((selectedInOrder.length - 1) / 2)] ?? null;

  const tileProps = (tile: TileId) => ({
    tile,
    selected: selection.includes(tile),
    rings: options.filter((o) => o.candidates.includes(tile)).map((o) => o.color),
    dim: claimedTile !== null && options.length > 0 && !options.some((o) => o.candidates.includes(tile)),
    toolbar: tile === anchor ? selectionCommands : [],
    onClick: () => controls.clickTile(tile),
  });

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over) setArrangement(moveLoose(arrangement, Number(active.id), Number(over.id)));
  };

  const lastLoose = arrangement.loose[arrangement.loose.length - 1];
  const lockedSets = melds.length > 0 && (
    <div className="my-melds" title="Locked sets">
      <Melds melds={melds} size="md" />
    </div>
  );

  if (won) {
    return (
      <div className="my-hand">
        {lockedSets}
        <RevealedGroups groups={won.groups} size="md" winningTile={won.tile} />
      </div>
    );
  }

  return (
    <div className="my-hand">
      {lockedSets}
      {arrangement.groups.map((g, i) => (
        <div key={g.join(",")} className="hand-group">
          <button className="ungroup" onClick={() => controls.ungroupAt(i)} title="Ungroup (select the group, then G)">
            Ungroup
          </button>
          {g.map((t) => (
            <HandTile key={t} {...tileProps(t)} />
          ))}
        </div>
      ))}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={arrangement.loose} strategy={horizontalListSortingStrategy}>
          <div className="hand-loose">
            {arrangement.loose.map((t) => (
              <SortableTile key={t} drawn={t === lastDrawn && t === lastLoose} {...tileProps(t)} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {claimedTile !== null && (
        <div className="claimed-slot" title="The tile you claimed">
          <Tile kind={kindOf(claimedTile)} glow />
          <span>claimed</span>
        </div>
      )}
    </div>
  );
}

interface HandTileProps {
  tile: TileId;
  selected: boolean;
  rings: string[];
  dim: boolean;
  toolbar: Command[];
  onClick(): void;
}

function HandTile({ tile, selected, rings, dim, toolbar, onClick }: HandTileProps) {
  return (
    <div className="hand-tile" onClick={onClick} data-tile={tile}>
      <Tile kind={kindOf(tile)} selected={selected} rings={rings} dim={dim} />
      <Toolbar commands={toolbar} />
    </div>
  );
}

function SortableTile({ drawn, ...props }: HandTileProps & { drawn: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.tile });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className={drawn ? "sortable drawn" : "sortable"}
      {...attributes}
      {...listeners}
    >
      <HandTile {...props} />
    </div>
  );
}

function Toolbar({ commands }: { commands: Command[] }) {
  if (commands.length === 0) return null;
  return (
    <div className="toolbar" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      {commands.map((c) => (
        <button key={c.label} onClick={c.run} style={c.color ? { background: c.color } : undefined}>
          {c.label}
          {c.key && <kbd>{c.key}</kbd>}
        </button>
      ))}
    </div>
  );
}
