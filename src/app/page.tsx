"use client";

import { useState } from "react";
import DynamicForm, { FormValues } from "@/components/DynamicForm";

const sampleFields = [
  {
    id: "fullName",
    label: "Full Name",
    type: "text" as const,
    required: true,
  },
  {
    id: "email",
    label: "Email Address",
    type: "email" as const,
    required: true,
  },
  {
    id: "phone",
    label: "Phone Number",
    type: "phone" as const,
    required: true,
  },
  {
    id: "country",
    label: "Country",
    type: "select" as const,
    required: true,
    options: [
      { label: "United Arab Emirates", value: "AE" },
      { label: "Saudi Arabia", value: "SA" },
      { label: "United States", value: "US" },
      { label: "United Kingdom", value: "GB" },
    ],
  },
  {
    id: "dateOfBirth",
    label: "Date of Birth",
    type: "date" as const,
    required: false,
  },
];

export default function Home() {
  const [formValues, setFormValues] = useState<FormValues>({});
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (values: FormValues) => {
    setSubmitting(true);
    setTimeout(() => {
      console.log("Submitted:", values);
      setSubmitting(false);
    }, 2000);
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          Event Registration
        </h1>
        <DynamicForm
          fields={sampleFields}
          values={formValues}
          onValuesChange={setFormValues}
          onSubmit={handleSubmit}
          showSubmit
          submitLabel="Register"
          submitting={submitting}
        />
      </div>
    </main>
  );
}
