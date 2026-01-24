@auth @travel
Feature: Traveler Authentication
  As a traveler
  I want to create a profile and log in
  So that I can manage my bookings and earn miles

  Background:
    Given I am on the travel site home page

  @smoke @TC_857
  Scenario: Successful Traveler Login
    When I navigate to the login portal
    And I enter valid frequent flyer credentials
      | username      | password |
      | flyer@air.com | FlyHigh! |
    And I click the "Sign In" button
    Then I should be redirected to the "My Trips" dashboard
    And I should see a welcome message "Welcome back, Captain"

  @TC_843
  Scenario Outline: Login with invalid credentials
    When I navigate to the login portal
    And I enter <username> and <password>
    And I click the "Sign In" button
    Then I should see an error message "<error>"

    Examples:
      | username        | password  | error               |
      | flyer@air.com   | wrongpass | Invalid credentials |
      | unknown@air.com | anypass   | Member not found    |
      |                 | FlyHigh!  | Email is required   |

  @TC_844
  Scenario: New Traveler Registration
    When I navigate to the join rewards page
    And I fill in the registration form details:
      | First Name | Last Name | Email          | Password  | Passport Number |
      | John       | Doe       | john.d@air.com | SecureP@1 | A12345678       |
    And I submit the form
    Then my frequent flyer account should be created successfully
    And I should receive 500 bonus miles
