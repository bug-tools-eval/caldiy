import type { EventTypeCustomInput } from "@calcom/prisma/client";
import { isValidPhoneNumber } from "libphonenumber-js/max";
import z from "zod";

type CustomInput = {
  value: string | boolean;
  label: string;
};

export function handleCustomInputs(
  eventTypeCustomInputs: EventTypeCustomInput[],
  reqCustomInputs: CustomInput[]
) {
  const inputByLabel = new Map(reqCustomInputs.map((input) => [input.label, input]));
  eventTypeCustomInputs.forEach((etcInput) => {
    if (etcInput.required) {
      const input = inputByLabel.get(etcInput.label);
      validateInput(etcInput, input?.value);
    }
  });
}

function validateInput(etcInput: EventTypeCustomInput, value: string | boolean | undefined) {
  const errorMessage = `Missing ${etcInput.type} customInput: '${etcInput.label}'`;

  if (etcInput.type === "BOOL") {
    validateBooleanInput(value, errorMessage);
  } else if (etcInput.type === "PHONE") {
    validatePhoneInput(value, errorMessage);
  } else {
    validateStringInput(value, errorMessage);
  }
}

function validateBooleanInput(value: string | boolean | undefined, errorMessage: string) {
  z.literal(true, {
    errorMap: () => ({ message: errorMessage }),
  }).parse(value);
}

function validatePhoneInput(value: string | boolean | undefined, errorMessage: string) {
  z.string({
    errorMap: () => ({ message: errorMessage }),
  })
    .refine((val) => isValidPhoneNumber(val), {
      message: "Phone number is invalid",
    })
    .parse(value);
}

function validateStringInput(value: string | boolean | undefined, errorMessage: string) {
  z.string({
    errorMap: () => ({ message: errorMessage }),
  })
    .min(1)
    .parse(value);
}
