"use client";

import React, { useState, useMemo } from "react";
import { Scissors, Plus, Edit2, Trash2, Check } from "lucide-react";
import { Service } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { triggerHaptic } from "@/lib/utils";

interface ServicesSectionProps {
  services: Service[];
  businessId: string;
  onAddService: (service: Partial<Service>) => Promise<void>;
  onEditService: (service: Service) => Promise<void>;
  onDeleteService?: (serviceId: string) => Promise<void>;
}

// Warm, on-brand tags (no blue/indigo): green, aubergine, terracotta, mustard, olive, ink.
const COLOR_OPTIONS = [
  "#1E4D36", // Bottle green
  "#7A3B69", // Aubergine
  "#B4532A", // Terracotta
  "#C98A0B", // Mustard
  "#5B6B2E", // Olive
  "#3A433C", // Ink
];

export const ServicesSection: React.FC<ServicesSectionProps> = ({
  services,
  businessId,
  onAddService,
  onEditService,
  onDeleteService,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState("");
  const [category, setCategory] = useState("כללי");
  const [duration, setDuration] = useState("30");
  const [buffer, setBuffer] = useState("10");
  const [price, setPrice] = useState("80");
  const [colorTag, setColorTag] = useState(COLOR_OPTIONS[0]);

  // Extract unique categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    services.forEach((s) => {
      if (s.category) set.add(s.category);
    });
    return Array.from(set);
  }, [services]);

  const filteredServices = useMemo(() => {
    if (selectedCategory === "all") return services;
    return services.filter((s) => (s.category || "כללי") === selectedCategory);
  }, [services, selectedCategory]);

  const openAdd = () => {
    triggerHaptic(15);
    setEditingId(null);
    setName("");
    setCategory("כללי");
    setDuration("30");
    setBuffer("10");
    setPrice("80");
    setColorTag(COLOR_OPTIONS[0]);
    setIsModalOpen(true);
  };

  const openEdit = (s: Service) => {
    triggerHaptic(15);
    setEditingId(s.id);
    setName(s.name);
    setCategory(s.category || "כללי");
    setDuration(String(s.duration_minutes));
    setBuffer(String(s.buffer_minutes));
    setPrice(String(s.price));
    setColorTag(s.color_tag || COLOR_OPTIONS[0]);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !duration || !price) return;

    triggerHaptic(20);
    if (editingId) {
      await onEditService({
        id: editingId,
        business_id: businessId,
        name: name.trim(),
        category: category.trim(),
        duration_minutes: Number(duration),
        buffer_minutes: Number(buffer) || 0,
        price: Number(price),
        color_tag: colorTag,
      });
    } else {
      await onAddService({
        business_id: businessId,
        name: name.trim(),
        category: category.trim(),
        duration_minutes: Number(duration),
        buffer_minutes: Number(buffer) || 0,
        price: Number(price),
        color_tag: colorTag,
      });
    }

    setIsModalOpen(false);
  };

  return (
    <div className="space-y-4">
      {/* Top action bar & Category filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          <button
            onClick={() => setSelectedCategory("all")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              selectedCategory === "all"
                ? "bg-indigo-600 text-white shadow-xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            הכל ({services.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                selectedCategory === cat
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <Button size="sm" onClick={openAdd} className="shadow-xs whitespace-nowrap">
          <Plus className="w-4 h-4 ml-1" />
          <span>הוסף שירות חדש</span>
        </Button>
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredServices.map((service) => (
          <Card
            key={service.id}
            className="p-4 bg-white border border-slate-200/90 shadow-xs text-right flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div
                  className="w-10 h-10 rounded-2xl text-white flex items-center justify-center font-bold flex-shrink-0 shadow-xs"
                  style={{ backgroundColor: service.color_tag || "#1E4D36" }}
                >
                  <Scissors className="w-5 h-5" />
                </div>

                <div className="flex-1 text-right">
                  <div className="font-extrabold text-slate-900 text-sm">{service.name}</div>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">
                    {service.category || "שירות כללי"}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEdit(service)}
                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded-lg transition-colors"
                    title="ערוך שירות"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  {onDeleteService && (
                    <button
                      onClick={() => onDeleteService(service.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      title="מחק שירות"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between py-2 border-y border-slate-100 text-xs">
                <div>
                  <span className="text-slate-400">משך זמן: </span>
                  <span className="font-extrabold text-slate-800">{service.duration_minutes} דק&apos;</span>
                </div>
                <div>
                  <span className="text-slate-400">התארגנות (Buffer): </span>
                  <span className="font-extrabold text-amber-700">+{service.buffer_minutes} דק&apos;</span>
                </div>
                <div>
                  <span className="text-slate-400">מחיר: </span>
                  <span className="font-black text-indigo-700 text-sm font-mono">₪{service.price}</span>
                </div>
              </div>
            </div>

            <div className="pt-2 text-[11px] text-slate-400 flex items-center justify-between">
              <span>סך זמן משוער ביומן:</span>
              <span className="font-bold text-slate-700">
                ~ {service.duration_minutes + service.buffer_minutes} דקות
              </span>
            </div>
          </Card>
        ))}
      </div>

      {/* Add / Edit Service Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingId ? "עריכת שירות קיים" : "הוספת שירות חדש למחירון"}
      >
        <form onSubmit={handleSubmit} className="space-y-3.5 text-right">
          <Input
            label="שם השירות *"
            placeholder="תספורת גברים / מניקור לק ג'ל"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <Input
            label="קטגוריית השירות"
            placeholder="תספורות וזקן / טיפולי יופי / כללי"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="משך הטיפול (בדקות) *"
              type="number"
              placeholder="30"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              required
            />
            <Input
              label="זמן התארגנות (Buffer בדקות)"
              type="number"
              placeholder="10"
              value={buffer}
              onChange={(e) => setBuffer(e.target.value)}
              helperText="חסימה אוטומטית בין לקוחות"
            />
          </div>

          <Input
            label="מחיר השירות (₪) *"
            type="number"
            placeholder="80"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />

          {/* Color tag selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">צבע תגית ביומן</label>
            <div className="flex items-center gap-2">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColorTag(c)}
                  className={`w-7 h-7 rounded-full transition-transform flex items-center justify-center ${
                    colorTag === c ? "scale-110 ring-2 ring-indigo-500 ring-offset-2" : "hover:scale-105"
                  }`}
                  style={{ backgroundColor: c }}
                >
                  {colorTag === c && <Check className="w-3.5 h-3.5 text-white" />}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setIsModalOpen(false)}>
              ביטול
            </Button>
            <Button type="submit" className="flex-1">
              {editingId ? "שמור שינויים" : "צור שירות"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
