@checkout @travel
Feature: Flight Booking and Payment
  As a traveler
  I want to pay for my selected flights
  So that my seat is confirmed

  Background:
    Given I have a confirmed itinerary
    And I am on the payment page

  @critical @smoke @TC_840
  Scenario: Guest Booking with Credit Card
    Given I choose to checkout as Guest
    When I enter passenger details:
      | Name    | Passport | Nationality |
      | Jane Do | A1234567 | USA         |
    And I enter valid credit card details
    And I click "Pay & Book"
    Then I should see the Booking Confirmation page
    And I should receive an e-ticket via email

  @TC_828
  Scenario: Pay with Travel Points
    Given I am logged in as a frequent flyer
    When I select "Pay with Miles" option
    And I authorize the points deduction
    Then the booking should be confirmed without credit card charge

  @negative @TC_829
  Scenario: Booking with expired credit card
    Given I choose to pay by Credit Card
    When I enter an expired credit card
    And I click "Pay & Book"
    Then I should see a payment error "Card Expired"
    And the booking should not be created
