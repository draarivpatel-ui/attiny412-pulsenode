// ATtiny412 PulseNode Firmware (megaTinyCore / UPDI)
// 8-Pin SOIC-8: Pin 1=VCC, Pin 2=PA6(DAC/Buzzer), Pin 3=PA7(LDR ADC),
// Pin 4=PA1(Button), Pin 5=PA2(Status LED), Pin 6=PA0(UPDI), Pin 7=PA3(PWM LED), Pin 8=GND

#include <Arduino.h>

constexpr uint8_t PIN_BUZZER = PIN_PA6;
constexpr uint8_t PIN_LDR    = PIN_PA7;
constexpr uint8_t PIN_BTN    = PIN_PA1;
constexpr uint8_t PIN_STATUS = PIN_PA2;
constexpr uint8_t PIN_PWM    = PIN_PA3;

uint8_t mode = 0; // 0 = auto ambient dimming, 1 = 25-min study pulse, 2 = beacon

void setup() {
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LDR, INPUT);
  pinMode(PIN_BTN, INPUT_PULLUP);
  pinMode(PIN_STATUS, OUTPUT);
  pinMode(PIN_PWM, OUTPUT);
}

void loop() {
  static bool lastBtn = HIGH;
  bool btn = digitalRead(PIN_BTN);
  if (lastBtn == HIGH && btn == LOW) {
    mode = (mode + 1) % 3;
    tone(PIN_BUZZER, 1760, 45);
    delay(180);
  }
  lastBtn = btn;

  uint16_t rawLdr = analogRead(PIN_LDR);
  if (mode == 0) {
    uint8_t pwm = map(constrain(rawLdr, 60, 960), 60, 960, 255, 18);
    analogWrite(PIN_PWM, pwm);
    digitalWrite(PIN_STATUS, LOW);
  } else if (mode == 1) {
    uint32_t phase = (millis() / 12) % 510;
    uint8_t breath = phase < 255 ? phase : (510 - phase);
    analogWrite(PIN_PWM, breath);
    digitalWrite(PIN_STATUS, HIGH);
  } else {
    analogWrite(PIN_PWM, (millis() / 250) % 2 ? 240 : 0);
    digitalWrite(PIN_STATUS, (millis() / 250) % 2 ? LOW : HIGH);
  }
  delay(10);
}
