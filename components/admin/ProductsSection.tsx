"use client";

import React, { useState } from "react";
import { Package, Plus, AlertCircle, Search, X, Trash2 } from "lucide-react";
import { Product } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { triggerHaptic } from "@/lib/utils";
import { confirmDialog } from "@/lib/dialogs";

interface ProductsSectionProps {
  products: Product[];
  businessId: string;
  onAddProduct?: (prod: Partial<Product>) => void;
  onDeleteProduct?: (productId: string) => void;
}

export const ProductsSection: React.FC<ProductsSectionProps> = ({
  products,
  businessId,
  onAddProduct,
  onDeleteProduct,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // New product form
  const [name, setName] = useState("");
  const [category, setCategory] = useState("עיצוב שיער");
  const [sku, setSku] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [stock, setStock] = useState("10");
  const [minAlert, setMinAlert] = useState("5");

  const filteredProducts = products.filter((p) => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return true;
    return (
      p.name.toLowerCase().includes(term) ||
      p.category.toLowerCase().includes(term) ||
      (p.sku || "").toLowerCase().includes(term)
    );
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !salePrice) return;

    triggerHaptic(25);
    const newProd: Partial<Product> = {
      id: "prod-" + Math.random().toString(36).substring(2, 9),
      business_id: businessId,
      name: name.trim(),
      category: category.trim(),
      sku: sku.trim() || "PRD-" + Math.floor(Math.random() * 1000),
      cost_price: Number(costPrice) || 0,
      sale_price: Number(salePrice),
      stock_quantity: Number(stock) || 0,
      min_stock_alert: Number(minAlert) || 3,
    };

    if (onAddProduct) {
      onAddProduct(newProd);
    }

    setIsAddModalOpen(false);
    setName("");
    setSku("");
    setCostPrice("");
    setSalePrice("");
    setStock("10");
  };

  return (
    <div className="space-y-4">
      {/* Top search & Action bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-ink-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="חיפוש מוצר לפי שם, מק&quot;ט או קטגוריה..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-10 pl-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all font-medium text-right"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <Button
          size="sm"
          onClick={() => {
            triggerHaptic(15);
            setIsAddModalOpen(true);
          }}
          className="shadow-xs whitespace-nowrap"
        >
          <Plus className="w-4 h-4 ml-1" />
          <span>הוסף מוצר חדש</span>
        </Button>
      </div>

      {/* Products Table/Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredProducts.map((product) => {
          const isLowStock = product.stock_quantity <= product.min_stock_alert;
          const profit = product.sale_price - product.cost_price;

          return (
            <Card
              key={product.id}
              className="p-4 bg-white border border-slate-200/90 shadow-xs text-right flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold flex-shrink-0 border border-amber-100">
                      <Package className="w-5 h-5" />
                    </div>
                    {onDeleteProduct && (
                      <button
                        type="button"
                        onClick={async () => {
                          triggerHaptic(20);
                          if (await confirmDialog(`האם אתה בטוח שברצונך למחוק את המוצר "${product.name}"?`, { confirmLabel: "למחוק", danger: true })) {
                            onDeleteProduct(product.id);
                          }
                        }}
                        className="p-1.5 text-ink-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                        title="מחק מוצר מהמלאי"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <div className="flex-1 text-right">
                    <div className="font-extrabold text-slate-900 text-sm">{product.name}</div>
                    <div className="text-xs text-ink-500 font-medium mt-0.5">
                      {product.category} {product.sku && `• מק״ט: ${product.sku}`}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between py-2 border-y border-slate-100 text-xs">
                  <div>
                    <span className="text-ink-500">עלות: </span>
                    <span className="font-bold text-slate-700">₪{product.cost_price}</span>
                  </div>
                  <div>
                    <span className="text-ink-500">מחיר מכירה: </span>
                    <span className="font-extrabold text-indigo-600 text-sm">₪{product.sale_price}</span>
                  </div>
                  <div>
                    <span className="text-ink-500">רווח: </span>
                    <span className="font-bold text-emerald-600">+₪{profit}</span>
                  </div>
                </div>
              </div>

              {/* Stock Bar */}
              <div className="pt-3 flex items-center justify-between text-xs">
                <span className="text-slate-500 font-medium">כמות במלאי:</span>
                <span
                  className={`font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                    isLowStock
                      ? "bg-rose-50 text-rose-700 border border-rose-200"
                      : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  }`}
                >
                  {isLowStock && <AlertCircle className="w-3 h-3" />}
                  <span>{product.stock_quantity} יחידות</span>
                  {isLowStock && <span className="text-[10px]">(מלאי נמוך!)</span>}
                </span>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Add Product Modal */}
      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="הוספת מוצר למלאי">
        <form onSubmit={handleCreate} className="space-y-3 text-right">
          <Input
            label="שם המוצר *"
            placeholder="לדוגמה: ווקס חימר חזק 100 מ&quot;ל"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="קטגוריה"
              placeholder="עיצוב שיער / טיפוח"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <Input
              label="מק&quot;ט / ברקוד"
              placeholder="WX-100"
              dir="ltr"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="מחיר עלות (₪)"
              type="number"
              placeholder="30"
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
            />
            <Input
              label="מחיר מכירה ללקוח (₪) *"
              type="number"
              placeholder="70"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="כמות התחלתית במלאי"
              type="number"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
            />
            <Input
              label="התראת מלאי נמוך מתחת ל-"
              type="number"
              value={minAlert}
              onChange={(e) => setMinAlert(e.target.value)}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setIsAddModalOpen(false)}>
              ביטול
            </Button>
            <Button type="submit" className="flex-1">
              שמור מוצר
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
