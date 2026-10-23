"use client";

import { useParams } from "next/navigation";
import { ManageAppointment } from "@/components/booking/ManageAppointment";

export default function CancelAppointmentPage() {
  const params = useParams();
  return <ManageAppointment source={{ mode: "id", id: params.id as string }} />;
}
