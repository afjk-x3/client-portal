"use client";

import { useState, type DragEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LIMITS, MAX_ITEMS_PER_REQUEST } from "@/lib/constants";
import { moveItem, newEditorItem, type EditorItem } from "@/lib/editor-items";

/**
 * Ordered list of checklist items. Shared by the request and template editors.
 * Items move with the up and down buttons, or by dragging the handle with a
 * mouse; touch screens fire no drag events, so the buttons stay.
 */
export function ItemEditor({ items, onChange }: { items: EditorItem[]; onChange: (items: EditorItem[]) => void }) {
  const [dragging, setDragging] = useState<number | null>(null);
  // The gap the dragged item would drop into: 0 is above the first item, items.length below the last.
  const [dropAt, setDropAt] = useState<number | null>(null);

  function update(index: number, patch: Partial<EditorItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  // The gap above or below item `index`, whichever half the pointer is over.
  function gapAt(event: DragEvent<HTMLDivElement>, index: number) {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientY < box.top + box.height / 2 ? index : index + 1;
  }

  function dragOver(event: DragEvent<HTMLDivElement>, index: number) {
    if (dragging === null) return;
    event.preventDefault(); // allows the drop
    setDropAt(gapAt(event, index));
  }

  // Measured again here: React may not have rendered the last dragover's state yet.
  function drop(event: DragEvent<HTMLDivElement>, index: number) {
    event.preventDefault(); // also stops the browser typing the drag data into an input
    if (dragging !== null) {
      const gap = gapAt(event, index);
      onChange(moveItem(items, dragging, gap > dragging ? gap - 1 : gap));
    }
    setDragging(null);
    setDropAt(null);
  }

  const indicator = <div aria-hidden="true" className="h-0.5 rounded bg-primary" />;

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, index) => (
        <div
          key={item.key}
          onDragOver={(event) => dragOver(event, index)}
          onDrop={(event) => drop(event, index)}
          className="flex flex-col gap-3"
        >
          {dragging !== null && dropAt === index && indicator}
          <Card className={dragging === index ? "opacity-50" : undefined}>
            <CardContent className="flex gap-3">
              <div className="flex flex-col items-center gap-1 pt-2 text-sm text-muted-foreground">
                <span
                  draggable
                  title={`Drag item ${index + 1}`}
                  aria-hidden="true"
                  className="cursor-grab active:cursor-grabbing"
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", String(index)); // Firefox starts a drag only with data
                    const card = event.currentTarget.closest("[data-slot=card]");
                    if (card) event.dataTransfer.setDragImage(card, 16, 16);
                    setDragging(index);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropAt(null);
                  }}
                >
                  <GripVertical className="size-4" />
                </span>
                <span>{index + 1}.</span>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <Input
                  aria-label={`Item ${index + 1} title`}
                  placeholder="What do you need?"
                  value={item.title}
                  maxLength={LIMITS.name}
                  onChange={(e) => update(index, { title: e.target.value })}
                />
                <Textarea
                  aria-label={`Item ${index + 1} description`}
                  placeholder="Details for the client (optional)"
                  value={item.description}
                  maxLength={LIMITS.description}
                  rows={2}
                  onChange={(e) => update(index, { description: e.target.value })}
                />
                <div className="flex flex-wrap items-center gap-4">
                  <Select value={item.kind} onValueChange={(kind) => update(index, { kind: kind as EditorItem["kind"] })}>
                    <SelectTrigger aria-label={`Item ${index + 1} type`} className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="file">File upload</SelectItem>
                      <SelectItem value="text">Written answer</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`required-${item.key}`}
                      checked={item.required}
                      onCheckedChange={(checked) => update(index, { required: checked === true })}
                    />
                    <Label htmlFor={`required-${item.key}`}>Required</Label>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move item ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => onChange(moveItem(items, index, index - 1))}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move item ${index + 1} down`}
                  disabled={index === items.length - 1}
                  onClick={() => onChange(moveItem(items, index, index + 1))}
                >
                  <ArrowDown />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove item ${index + 1}`}
                  onClick={() => onChange(items.filter((_, i) => i !== index))}
                >
                  <Trash2 />
                </Button>
              </div>
            </CardContent>
          </Card>
          {dragging !== null && dropAt === items.length && index === items.length - 1 && indicator}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={items.length >= MAX_ITEMS_PER_REQUEST}
        onClick={() => onChange([...items, newEditorItem()])}
      >
        <Plus />
        Add item
      </Button>
    </div>
  );
}
