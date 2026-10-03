import type { catalogItems } from "@/db/schema";

type CatalogItem = typeof catalogItems.$inferInsert;

/** Fictional laptop store catalog. Note: no dedicated-GPU laptop costs under $899. */
export const catalog: CatalogItem[] = [
  { sku: "CHROMA-14", name: "Chroma 14", priceUsd: 349, cpu: "Celeron N5100", ramGb: 4, storageGb: 64, gpu: "Integrated", dedicatedGpu: false, weightKg: 1.5, screenIn: 14, batteryHours: 10, useCases: ["student", "everyday"] },
  { sku: "CAMPUS-14", name: "Campus 14", priceUsd: 499, cpu: "Ryzen 5 7520U", ramGb: 8, storageGb: 256, gpu: "Integrated", dedicatedGpu: false, weightKg: 1.45, screenIn: 14, batteryHours: 10, useCases: ["student", "everyday"] },
  { sku: "CAMPUS-15", name: "Campus 15", priceUsd: 579, cpu: "Ryzen 5 7530U", ramGb: 16, storageGb: 512, gpu: "Integrated", dedicatedGpu: false, weightKg: 1.75, screenIn: 15.6, batteryHours: 9, useCases: ["student", "everyday"] },
  { sku: "AERO-13", name: "Aero 13", priceUsd: 649, cpu: "Core Ultra 5 125U", ramGb: 16, storageGb: 512, gpu: "Integrated", dedicatedGpu: false, weightKg: 1.19, screenIn: 13.3, batteryHours: 14, useCases: ["student", "everyday", "travel"] },
  { sku: "NITRO-15", name: "Nitro 15", priceUsd: 899, cpu: "Core i5-13420H", ramGb: 16, storageGb: 512, gpu: "RTX 4050 6GB", dedicatedGpu: true, weightKg: 2.1, screenIn: 15.6, batteryHours: 5, useCases: ["gaming"] },
  { sku: "FEATHER-14", name: "Feather 14", priceUsd: 999, cpu: "Core Ultra 7 155U", ramGb: 16, storageGb: 1024, gpu: "Integrated", dedicatedGpu: false, weightKg: 0.99, screenIn: 14, batteryHours: 16, useCases: ["business", "travel", "student"] },
  { sku: "SLATE-13", name: "Slate 13", priceUsd: 1199, cpu: "Snapdragon X Plus", ramGb: 16, storageGb: 512, gpu: "Integrated", dedicatedGpu: false, weightKg: 1.24, screenIn: 13.6, batteryHours: 18, useCases: ["everyday", "travel", "creative"] },
  { sku: "DEVBOOK-14", name: "DevBook 14", priceUsd: 1299, cpu: "Ryzen 7 8840HS", ramGb: 32, storageGb: 1024, gpu: "Integrated", dedicatedGpu: false, weightKg: 1.39, screenIn: 14, batteryHours: 12, useCases: ["programming", "business"] },
  { sku: "STRIKER-16", name: "Striker 16", priceUsd: 1499, cpu: "Core i7-14650HX", ramGb: 16, storageGb: 1024, gpu: "RTX 4070 8GB", dedicatedGpu: true, weightKg: 2.4, screenIn: 16, batteryHours: 5, useCases: ["gaming", "creative"] },
  { sku: "STUDIO-16", name: "Studio 16", priceUsd: 2099, cpu: "Core i9-14900HX", ramGb: 32, storageGb: 2048, gpu: "RTX 4070 8GB", dedicatedGpu: true, weightKg: 2.1, screenIn: 16, batteryHours: 8, useCases: ["video editing", "creative"] },
  { sku: "STUDIO-16-MAX", name: "Studio 16 Max", priceUsd: 2899, cpu: "Core i9-14900HX", ramGb: 64, storageGb: 2048, gpu: "RTX 4080 12GB", dedicatedGpu: true, weightKg: 2.3, screenIn: 16, batteryHours: 7, useCases: ["video editing", "creative", "gaming"] },
  { sku: "TITAN-18", name: "Titan 18", priceUsd: 3299, cpu: "Core i9-14900HX", ramGb: 32, storageGb: 2048, gpu: "RTX 4090 16GB", dedicatedGpu: true, weightKg: 3.1, screenIn: 18, batteryHours: 4, useCases: ["gaming"] },
];
