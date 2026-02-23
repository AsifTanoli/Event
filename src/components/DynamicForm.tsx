import React, { FormEvent, useState } from "react";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/style.css";
import { Loader2 } from "lucide-react";

interface FieldOption {
  label: string;
  value: string | number;
}

interface Field {
  id: string | number;
  label: string;
  arabicLabel?: string;
  type: "text" | "email" | "select" | "phone" | "date";
  required?: boolean;
  options?: FieldOption[];
}

export interface FormValues {
  [key: string]: string;
}

interface DynamicFormProps {
  fields: Field[];
  values?: FormValues;
  onSubmit?: (values: FormValues) => void;
  onValuesChange?: (values: FormValues) => void;
  showSubmit?: boolean;
  submitLabel?: string;
  submitting?: boolean;
}

export default function DynamicForm({
  fields,
  values,
  onSubmit,
  onValuesChange,
  showSubmit = false,
  submitLabel = "Submit",
  submitting = false,
}: DynamicFormProps) {
  // Controlled / uncontrolled support.
  const isControlled = values !== undefined && onValuesChange !== undefined;
  const [internalValues, setInternalValues] = useState<FormValues>({});
  const formValues = isControlled ? values! : internalValues;

  const setFormValues = (newValues: FormValues) => {
    if (isControlled) {
      onValuesChange?.(newValues);
    } else {
      setInternalValues(newValues);
    }
  };

  const [errors, setErrors] = useState<FormValues>({});
  const [touched, setTouched] = useState<Set<string | number>>(new Set());

  const validateField = (field: Field, value: string): string | null => {
    if (field.required && (!value || value.trim() === "")) {
      return "This field is required";
    }

    if (!value) return null;

    switch (field.type) {
      case "email": {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) return "Please enter a valid email address";
        break;
      }

      case "phone": {
        if (!value.startsWith("+")) return "Please select a country code";
        const allDigits = value.replace(/\D/g, "");
        const countryCodeMatch = value.match(/^\+(\d{1,4})/);
        if (!countryCodeMatch) {
          return "Please enter a valid phone number with country code";
        }
        const countryCodeLength = countryCodeMatch[1].length;
        const phoneDigits = allDigits.substring(countryCodeLength);
        if (phoneDigits.length < 7) {
          return "Phone number must have at least 7 digits";
        }
        if (allDigits.length < 10) {
          return "Phone number must be at least 10 digits including country code";
        }
        break;
      }

      case "text":
        if (
          (field.id === "fullName" || field.id.toString().toLowerCase().includes("name")) &&
          value.trim().length < 2
        ) {
          return "Name must be at least 2 characters";
        }
        if (
          (field.id === "emiratesId" ||
            field.id.toString().toLowerCase().includes("emiratesid")) &&
          value.replace(/\D/g, "").length !== 15
        ) {
          return "Emirates ID must be exactly 15 digits";
        }
        break;

      case "select":
        if (field.required && !value) return "Please select an option";
        break;

      case "date": {
        const selectedDate = new Date(value);
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        if (
          (field.id === "dateOfBirth" || field.id.toString().toLowerCase().includes("dob")) &&
          selectedDate > today
        ) {
          return "Date of birth cannot be in the future";
        }
        break;
      }
    }

    return null;
  };

  const handleChange = (id: string | number, value: string) => {
    setFormValues({ ...formValues, [id]: value });

    setErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[id];
      return newErrors;
    });

    if (touched.has(id)) {
      const field = fields.find((f) => f.id === id);
      if (field) {
        const error = validateField(field, value);
        if (error) setErrors((prev) => ({ ...prev, [id]: error }));
      }
    }
  };

  const handleBlur = (id: string | number) => {
    setTouched((prev) => new Set(prev).add(id));
    const field = fields.find((f) => f.id === id);
    if (field) {
      const error = validateField(field, formValues[id] || "");
      if (error) setErrors((prev) => ({ ...prev, [id]: error }));
      else {
        setErrors((prev) => {
          const e = { ...prev };
          delete e[id];
          return e;
        });
      }
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!showSubmit) return;

    const newErrors: FormValues = {};
    const newTouched = new Set<string | number>();

    fields.forEach((field) => {
      newTouched.add(field.id);
      const val = formValues[field.id] || "";
      const error = validateField(field, val);
      if (error) newErrors[field.id] = error;
    });

    setTouched(newTouched);
    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      onSubmit?.(formValues);
    }
  };

  const isPhoneField = (field: Field) =>
    field.type === "phone" ||
    field.id.toString().toLowerCase().includes("phone") ||
    field.label.toLowerCase().includes("phone");

  const isCountrySelected = () => {
    const countryValue =
      formValues.country ||
      formValues.Country ||
      formValues.countryCode ||
      formValues.CountryCode;
    return !!(countryValue && countryValue.trim() !== "");
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {fields.map((field) => {
        if (isPhoneField(field)) {
          const countrySelected = isCountrySelected();

          return (
            <div key={field.id} className="w-full">
              {field.arabicLabel ? (
                <label className="mb-2 flex items-center justify-between text-sm font-semibold text-gray-900">
                  <span>{field.label}</span>
                  <span dir="rtl" className="text-gray-600">
                    {field.arabicLabel}
                  </span>
                </label>
              ) : (
                <label className="mb-2 block text-sm font-semibold text-gray-900">
                  {field.label}
                  {field.required && <span className="ml-1 text-red-500">*</span>}
                </label>
              )}

              <PhoneInput
                countryCodeEditable={false}
                country={formValues[field.id] ? undefined : "ae"}
                value={formValues[field.id] || ""}
                onChange={(val) => handleChange(field.id, val)}
                onBlur={() => handleBlur(field.id)}
                inputProps={{
                  required: field.required,
                  name: field.id.toString(),
                }}
                containerClass="w-full"
                inputClass={`!w-full !h-[44px] !px-12 !py-2.5 !border-2 !rounded-lg ${
                  errors[field.id]
                    ? "!border-red-500"
                    : "!border-gray-300 focus:!border-primary"
                }`}
                buttonClass={`!border-2 !rounded-l-lg ${
                  !countrySelected && field.required ? "!border-red-500" : "!border-gray-300"
                }`}
              />

              {errors[field.id] && <p className="mt-1 text-sm text-red-600">{errors[field.id]}</p>}
            </div>
          );
        }

        if (field.type === "text" || field.type === "email" || field.type === "date") {
          const isDOB = field.id === "dateOfBirth" || field.id.toString().toLowerCase().includes("dob");
          const maxDate = isDOB ? new Date().toISOString().split("T")[0] : undefined;

          return (
            <div key={field.id} className="w-full">
              <label className="mb-2 block text-sm font-semibold text-gray-900">{field.label}</label>

              <input
                type={field.type}
                value={formValues[field.id] || ""}
                onChange={(e) => handleChange(field.id, e.target.value)}
                onBlur={() => handleBlur(field.id)}
                max={maxDate}
                required={field.required}
                className={`w-full rounded-lg border-2 px-4 py-2.5 ${
                  errors[field.id] ? "border-red-500" : "border-gray-300"
                }`}
              />

              {errors[field.id] && <p className="mt-1 text-sm text-red-600">{errors[field.id]}</p>}
            </div>
          );
        }

        if (field.type === "select" && field.options) {
          return (
            <div key={field.id} className="w-full">
              <label className="mb-2 block text-sm font-semibold text-gray-900">{field.label}</label>

              <select
                value={formValues[field.id] || ""}
                onChange={(e) => handleChange(field.id, e.target.value)}
                onBlur={() => handleBlur(field.id)}
                required={field.required}
                className={`w-full rounded-lg border-2 px-4 py-2.5 ${
                  errors[field.id] ? "border-red-500" : "border-gray-300"
                }`}
              >
                <option value="">Select {field.label}</option>
                {field.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              {errors[field.id] && <p className="mt-1 text-sm text-red-600">{errors[field.id]}</p>}
            </div>
          );
        }

        return null;
      })}

      {showSubmit && (
        <div className="pt-2">
          <button
            type="submit"
            disabled={submitting}
            className={`flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-white ${
              submitting ? "cursor-not-allowed opacity-50" : ""
            }`}
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              submitLabel
            )}
          </button>
        </div>
      )}
    </form>
  );
}
