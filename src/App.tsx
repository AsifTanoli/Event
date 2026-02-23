import { useState } from "react";
import DynamicForm, { Field, FormValues } from "./components/DynamicForm";

const fields: Field[] = [
  { id: "fullName", label: "Full name", arabicLabel: "الاسم الكامل", type: "text", required: true },
  { id: "email", label: "Email", arabicLabel: "البريد الإلكتروني", type: "email", required: true },
  { id: "emiratesId", label: "Emirates ID", arabicLabel: "الهوية الإماراتية", type: "text", required: true },
  { id: "dateOfBirth", label: "Date of birth", arabicLabel: "تاريخ الميلاد", type: "date", required: true },
  { id: "phone", label: "Phone", arabicLabel: "رقم الهاتف", type: "phone", required: true },
  {
    id: "gender",
    label: "Gender",
    arabicLabel: "الجنس",
    type: "select",
    required: true,
    options: [
      { label: "Male", value: "male" },
      { label: "Female", value: "female" },
    ],
  },
];

export default function App() {
  const [values, setValues] = useState<FormValues>({});
  const [submitted, setSubmitted] = useState<FormValues | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="min-h-full flex items-start justify-center p-6">
      <div className="w-full max-w-xl bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">
            Dynamic Form Validation
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Demo page for field-level validation and controlled values.
          </p>
        </div>

        <DynamicForm
          fields={fields}
          values={values}
          onValuesChange={setValues}
          showSubmit
          submitLabel="Submit"
          submitting={submitting}
          onSubmit={(vals) => {
            setSubmitting(true);
            setSubmitted(vals);
            setSubmitting(false);
          }}
        />

        <div className="mt-6">
          <h2 className="text-sm font-semibold text-gray-900">
            Current values
          </h2>
          <pre className="mt-2 text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-auto">
            {JSON.stringify(values, null, 2)}
          </pre>

          {submitted && (
            <>
              <h2 className="text-sm font-semibold text-gray-900 mt-4">
                Last submit payload
              </h2>
              <pre className="mt-2 text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-auto">
                {JSON.stringify(submitted, null, 2)}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

