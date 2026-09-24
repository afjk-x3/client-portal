"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LIMITS, MAX_ITEMS_PER_REQUEST } from "@/lib/constants";
import { newEditorItem, type EditorItem } from "@/lib/editor-items";

/** Ordered list of checklist items. Shared by the request and template editors. */
export function ItemEditor({ items, onChange }: { items: EditorItem[]; onChange: (items: EditorItem[]) => void }) {
  function update(index: number, patch: Partial<EditorItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function move(index: number, offset: -1 | 1) {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + offset, 0, item);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, index) => (
        <Card key={item.key}>
          <CardContent className="flex gap-3">
            <span className="pt-2 text-sm text-muted-foreground">{index + 1}.</span>
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
                onClick={() => move(index, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Move item ${index + 1} down`}
                disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
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
